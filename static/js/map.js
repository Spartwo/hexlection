// ── Global map state ───────────────────────────────────────────────────────────
let origColors = null;
let GRID_COLS  = 0, GRID_ROWS = 0;

const canvas  = document.getElementById('map-canvas');
const ctx     = canvas.getContext('2d');
const mapWrap = document.getElementById('map-wrap');

let r = 6, originX = 0, originY = 0, zoom = 1, panX = 0, panY = 0;

// ── Canvas sizing ──────────────────────────────────────────────────────────────
function resizeCanvas() {
  canvas.width  = mapWrap.clientWidth;
  canvas.height = mapWrap.clientHeight;
}

function computeLayout() {
  resizeCanvas();
  if (!GRID_COLS || !GRID_ROWS) return;
  const pad   = 24;
  const gridW = GRID_COLS * 1.5 + 0.5;
  const gridH = GRID_ROWS * SQRT3 + SQRT3 / 2;
  const fitW  = (canvas.width  - pad * 2) / gridW;
  const fitH  = (canvas.height - pad * 2) / gridH;
  r = Math.max(1, Math.min(fitW, fitH));
  originX = (canvas.width  - gridW * r) / 2;
  originY = (canvas.height - gridH * r) / 2;
  zoom = 1; panX = 0; panY = 0;
}

// ── Hex geometry ───────────────────────────────────────────────────────────────
function cellCenter(col, row) {
  const er = r * zoom;
  return {
    cx: originX + panX + col * 1.5 * er + er,
    cy: originY + panY + row * SQRT3 * er + er * SQRT3 / 2 + (col % 2 === 1 ? er * SQRT3 / 2 : 0)
  };
}

// Flat-top hex neighbours — one per edge (edge i is between corner i and corner i+1)
function getNeighbour(col, row, ei) {
  const odd = col % 2 === 1;
  return [
    [col + 1, odd ? row + 1 : row    ],  // edge 0: lower-right
    [col,     row + 1                ],  // edge 1: below
    [col - 1, odd ? row + 1 : row    ],  // edge 2: lower-left
    [col - 1, odd ? row     : row - 1],  // edge 3: upper-left
    [col,     row - 1                ],  // edge 4: above
    [col + 1, odd ? row     : row - 1],  // edge 5: upper-right
  ][ei];
}

// ── Hit testing ────────────────────────────────────────────────────────────────
function inHex(sx, sy, cx, cy, er) {
  const dx = Math.abs(sx - cx), dy = Math.abs(sy - cy);
  if (dx > er) return false;
  if (dy > er * SQRT3 / 2) return false;
  return er * SQRT3 / 2 - dy - (SQRT3 / 2) * (dx - er / 2) >= 0 || dx <= er / 2;
}

function toGrid(sx, sy) {
  const er     = r * zoom;
  const colEst = Math.floor((sx - originX - panX - er / 2) / (1.5 * er));
  for (let dc = -1; dc <= 2; dc++) {
    const col = colEst + dc;
    if (col < 0 || col >= GRID_COLS) continue;
    const {cx: cx0, cy: cy0} = cellCenter(col, 0);
    const rowEst = Math.floor((sy - cy0 + er * SQRT3 / 2) / (SQRT3 * er));
    for (let dr = -1; dr <= 1; dr++) {
      const row = rowEst + dr;
      if (row < 0 || row >= GRID_ROWS) continue;
      if (!origColors || !origColors[row] || !origColors[row][col]) continue;
      const {cx, cy} = cellCenter(col, row);
      if (inHex(sx, sy, cx, cy, er)) return { col, row };
    }
  }
  return null;
}

// ── Image processing ───────────────────────────────────────────────────────────
function processImage(img) {
  const W = img.naturalWidth, H = img.naturalHeight;
  setStatus('analysing…');
  const full = document.createElement('canvas');
  full.width = W; full.height = H;
  full.getContext('2d').drawImage(img, 0, 0);
  const fullPx = full.getContext('2d').getImageData(0, 0, W, H).data;

  const freq = {};
  for (let i = 0; i < fullPx.length; i += 4) {
    const rv = fullPx[i], gv = fullPx[i+1], bv = fullPx[i+2];
    if (rv < BLK && gv < BLK && bv < BLK) continue;
    const key = (rv << 16) | (gv << 8) | bv;
    freq[key] = (freq[key] || 0) + 1;
  }
  const trueColors = Object.entries(freq)
    .filter(([,n]) => n >= MIN_TERRITORY_PX)
    .map(([k]) => { const ki = parseInt(k); return [(ki>>16)&0xff, (ki>>8)&0xff, ki&0xff]; });

  const tcFlat = new Float32Array(trueColors.length * 3);
  const tcHex  = [];
  trueColors.forEach(([rv,gv,bv], i) => {
    tcFlat[i*3] = rv; tcFlat[i*3+1] = gv; tcFlat[i*3+2] = bv;
    tcHex.push('#' + [rv,gv,bv].map(v => v.toString(16).padStart(2,'0')).join(''));
  });

  function snapToTrue(rv, gv, bv) {
    let bestDist = Infinity, bestIdx = 0;
    for (let i = 0; i < tcHex.length; i++) {
      const dr = tcFlat[i*3]-rv, dg = tcFlat[i*3+1]-gv, db = tcFlat[i*3+2]-bv;
      const d = dr*dr + dg*dg + db*db;
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    return tcHex[bestIdx];
  }

  const NW = Math.max(1, Math.round(W * SCALE_X));
  const NH = Math.max(1, Math.round(H * SCALE_Y));
  const bw = W / NW, bh = H / NH;
  GRID_COLS = NW; GRID_ROWS = NH;
  origColors = [];
  const uniqueHex = new Set();

  for (let row = 0; row < NH; row++) {
    origColors[row] = [];
    for (let col = 0; col < NW; col++) {
      const sx = Math.min(W-1, Math.floor((col+0.5)*bw));
      const sy = Math.min(H-1, Math.floor((row+0.5)*bh));
      const idx = (sy*W + sx) * 4;
      let rv = fullPx[idx], gv = fullPx[idx+1], bv = fullPx[idx+2];
      if (rv < BLK && gv < BLK && bv < BLK) {
        let found = null;
        for (const [ox,oy] of [[0.3,0.3],[0.7,0.3],[0.3,0.7],[0.7,0.7]]) {
          const x2 = Math.min(W-1, Math.floor(col*bw + ox*bw));
          const y2 = Math.min(H-1, Math.floor(row*bh + oy*bh));
          const i2 = (y2*W + x2) * 4;
          const r2 = fullPx[i2], g2 = fullPx[i2+1], b2 = fullPx[i2+2];
          if (!(r2 < BLK && g2 < BLK && b2 < BLK)) { found = [r2,g2,b2]; break; }
        }
        if (!found) { origColors[row][col] = null; continue; }
        [rv,gv,bv] = found;
      }
      const snapped = snapToTrue(rv,gv,bv);
      origColors[row][col] = snapped;
      uniqueHex.add(snapped);
    }
  }

  setStatus('');
  computeLayout(); renderResults(); render();
}

// ── Map render ─────────────────────────────────────────────────────────────────
function zoneSeats(zone) {
  if (!zone) return [];
  return (window.SEATS || []).filter(seat => seat.constituency === zone.constituency);
}

function partyByShort(short) {
  return PARTIES.find(p => p.short === short) || null;
}

function topSeatParty(zone) {
  const counts = {};
  zoneSeats(zone).forEach(seat => {
    if (!seat.short) return;
    counts[seat.short] = (counts[seat.short] || 0) + 1;
  });
  let bestShort = null, bestCount = 0;
  Object.entries(counts).forEach(([short, count]) => {
    if (count > bestCount) { bestShort = short; bestCount = count; }
  });
  return bestShort ? partyByShort(bestShort) : null;
}

function topSeatGroup(zone) {
  const counts = {};
  const colors = {};
  zoneSeats(zone).forEach(seat => {
    if (!seat.grp) return;
    counts[seat.grp] = (counts[seat.grp] || 0) + 1;
    if (!colors[seat.grp]) colors[seat.grp] = seat.intlColor;
  });
  let bestGroup = null, bestCount = 0;
  Object.entries(counts).forEach(([group, count]) => {
    if (count > bestCount) { bestGroup = group; bestCount = count; }
  });
  if (!bestGroup) return null;
  const groupInfo = (window.GROUPS || {})[bestGroup];
  return { key: bestGroup, color: groupInfo ? groupInfo.color : colors[bestGroup] };
}

function groupColor(groupKey) {
  const group = (window.GROUPS || {})[groupKey];
  if (group) return group.color;
  const party = PARTIES.find(p => p.grp === groupKey);
  return party ? party.color : null;
}

function groupVoteShare(zone, groupKey) {
  let pct = 0;
  Object.entries(zone.votes || {}).forEach(([short, vote]) => {
    const party = partyByShort(short);
    if (party && party.grp === groupKey) pct += vote;
  });
  return Math.max(0, Math.min(1, pct));
}

function hexToRgb(hexColor) {
  if (!/^#[0-9a-fA-F]{6}$/.test(hexColor || '')) return null;
  return {
    r: parseInt(hexColor.slice(1,3), 16),
    g: parseInt(hexColor.slice(3,5), 16),
    b: parseInt(hexColor.slice(5,7), 16)
  };
}

function rgbToHex({r, g, b}) {
  return '#' + [r, g, b].map(v => {
    const n = Math.max(0, Math.min(255, Math.round(v)));
    return n.toString(16).padStart(2, '0');
  }).join('');
}

function colourWithOpacityOverBase(baseColor, overlayColor, alpha) {
  const base = hexToRgb(baseColor);
  const overlay = hexToRgb(overlayColor);
  if (!base || !overlay) return FILL_UNASSIGNED();
  return rgbToHex({
    r: base.r + (overlay.r - base.r) * alpha,
    g: base.g + (overlay.g - base.g) * alpha,
    b: base.b + (overlay.b - base.b) * alpha
  });
}

function heatmapColor(baseColor, pct) {
  const alpha = Math.max(0, Math.min(1, pct / 0.51));
  if (!baseColor || alpha <= 0) return FILL_UNASSIGNED();
  return colourWithOpacityOverBase(FILL_UNASSIGNED(), baseColor, alpha);
}

function zoneFillColor(zone) {
  if (!zone) return FILL_UNASSIGNED();

  const pf = window.PARL_FILTER;
  if (pf && pf.value !== null) {
    if (pf.tab === 'party') {
      const party = partyByShort(pf.value);
      return heatmapColor(party ? party.color : null, zone.votes ? zone.votes[pf.value] || 0 : 0);
    }
    if (pf.tab === 'intl') {
      return heatmapColor(groupColor(pf.value), groupVoteShare(zone, pf.value));
    }
  }

  if (parlTab === 'intl') {
    const group = topSeatGroup(zone);
    return group ? group.color : FILL_UNASSIGNED();
  }

  const party = topSeatParty(zone);
  return party ? party.color : FILL_UNASSIGNED();
}

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = MAP_BG();
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  window._territoryLoops = {};
  if (!origColors) return;

  const er = r * zoom;

  // ── Pass 1: territory fills (directed half-edge walk) ─────────────────────
  {
    const SNAP = 0.5;
    function ptKey(x, y) { return Math.round(x/SNAP) + '_' + Math.round(y/SNAP); }
    const coordOf  = {};
    const dirEdges = {};

    for (let col = 0; col < GRID_COLS; col++) {
      for (let row = 0; row < GRID_ROWS; row++) {
        const hexA = origColors[row] && origColors[row][col];
        if (!hexA) continue;
        const {cx, cy} = cellCenter(col, row);
        for (let ei = 0; ei < 6; ei++) {
          const [nc, nr] = getNeighbour(col, row, ei);
          const inBounds  = nc >= 0 && nc < GRID_COLS && nr >= 0 && nr < GRID_ROWS;
          const hexB = inBounds ? (origColors[nr] && origColors[nr][nc]) : null;
          if (hexA === hexB) continue;

          const a1 = Math.PI/3 * ei;
          const a2 = Math.PI/3 * ((ei+1)%6);
          const x1 = cx + er*Math.cos(a1), y1 = cy + er*Math.sin(a1);
          const x2 = cx + er*Math.cos(a2), y2 = cy + er*Math.sin(a2);
          const k1 = ptKey(x1,y1), k2 = ptKey(x2,y2);
          coordOf[k1] = {x:x1,y:y1};
          coordOf[k2] = {x:x2,y:y2};

          if (!dirEdges[hexA]) dirEdges[hexA] = {};
          if (!dirEdges[hexA][k1]) dirEdges[hexA][k1] = [];
          dirEdges[hexA][k1].push({ key: k2, x: x2, y: y2 });
        }
      }
    }

    for (const [hexColor, startMap] of Object.entries(dirEdges)) {
      const displayMap = (parlTab === 'intl') ? window.ZONE_DISPLAY_INTL : window.ZONE_DISPLAY;
      const zd = displayMap && displayMap[hexColor];
      const fillColor = zd ? zoneFillColor(zd.zone) : FILL_UNASSIGNED();

      const remaining = {};
      for (const [k, arr] of Object.entries(startMap)) remaining[k] = [...arr];

      const loops = [];
      for (const startKey of Object.keys(remaining)) {
        while ((remaining[startKey]||[]).length > 0) {
          const loop = [];
          let curKey = startKey;
          let safety = Object.keys(remaining).length * 6 + 10;
          while (safety-- > 0) {
            const nexts = remaining[curKey];
            if (!nexts || nexts.length === 0) break;
            const next = nexts.shift();
            loop.push(coordOf[curKey]);
            if (next.key === startKey) break;
            curKey = next.key;
          }
          if (loop.length >= 3) loops.push(loop);
        }
      }

      ctx.beginPath();
      for (const loop of loops) {
        ctx.moveTo(loop[0].x, loop[0].y);
        for (let i = 1; i < loop.length; i++) ctx.lineTo(loop[i].x, loop[i].y);
        ctx.closePath();
      }
      ctx.fillStyle = fillColor;
      ctx.fill('evenodd');

      window._territoryLoops[hexColor] = loops;
    }
  }

  // ── Pass 1b: parliament filter overlay ────────────────────────────────────
  const pf = window.PARL_FILTER;
  if (pf && pf.tab === 'nation' && pf.value !== null && window._territoryLoops) {
    const matchColors = new Set();

    (window.ZONES || []).forEach(zone => {
      if (zone.color && zone.region === pf.value) matchColors.add(zone.color);
    });

    ctx.save();
    for (const [hexColor, loops] of Object.entries(window._territoryLoops)) {
      if (matchColors.has(hexColor)) continue;
      ctx.beginPath();
      for (const loop of loops) {
        ctx.moveTo(loop[0].x, loop[0].y);
        for (let i = 1; i < loop.length; i++) ctx.lineTo(loop[i].x, loop[i].y);
        ctx.closePath();
      }
      ctx.fillStyle = isDark() ? 'rgba(13,13,13,0.65)' : 'rgba(255,255,255,0.72)';
      ctx.fill('evenodd');
    }
    ctx.restore();
  }

  // ── Pass 1c: hover highlight ──────────────────────────────────────────────
  const hovHex = window.HOVERED_HEX;
  if (hovHex && window._territoryLoops && window._territoryLoops[hovHex]) {
    ctx.save();
    ctx.beginPath();
    for (const loop of window._territoryLoops[hovHex]) {
      ctx.moveTo(loop[0].x, loop[0].y);
      for (let i = 1; i < loop.length; i++) ctx.lineTo(loop[i].x, loop[i].y);
      ctx.closePath();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fill('evenodd');
    ctx.restore();
  }

  // ── Pass 2: edges ─────────────────────────────────────────────────────────
  const seen = new Set();
  const internal  = [];
  const boundary  = [];

  for (let col = 0; col < GRID_COLS; col++) {
    for (let row = 0; row < GRID_ROWS; row++) {
      const hexA = origColors[row] && origColors[row][col];
      if (!hexA) continue;
      const {cx, cy} = cellCenter(col, row);
      if (cx + er * 2 < 0 || cx - er * 2 > canvas.width)  continue;
      if (cy + er * 2 < 0 || cy - er * 2 > canvas.height) continue;

      for (let ei = 0; ei < 6; ei++) {
        const [nc, nr] = getNeighbour(col, row, ei);
        const inBounds  = nc >= 0 && nc < GRID_COLS && nr >= 0 && nr < GRID_ROWS;

        let key;
        if (inBounds) {
          const [c1, r1, c2, r2] = col < nc || (col === nc && row < nr)
            ? [col, row, nc, nr]
            : [nc, nr, col, row];
          key = c1 + ',' + r1 + '|' + c2 + ',' + r2;
        } else {
          key = col + ',' + row + '|e' + ei;
        }
        if (seen.has(key)) continue;
        seen.add(key);

        const hexB = inBounds ? (origColors[nr] && origColors[nr][nc]) : null;
        const a1 = Math.PI / 3 * ei;
        const a2 = Math.PI / 3 * ((ei + 1) % 6);
        const x1 = cx + er * Math.cos(a1), y1 = cy + er * Math.sin(a1);
        const x2 = cx + er * Math.cos(a2), y2 = cy + er * Math.sin(a2);

        if (hexA !== hexB) {
          boundary.push(x1, y1, x2, y2);
        } else {
          internal.push(x1, y1, x2, y2);
        }
      }
    }
  }

  if (internal.length) {
    ctx.beginPath();
    for (let i = 0; i < internal.length; i += 4) {
      ctx.moveTo(internal[i], internal[i+1]);
      ctx.lineTo(internal[i+2], internal[i+3]);
    }
    const internalAlpha = Math.max(0, Math.min(1, (zoom - 2) / 4));
    ctx.strokeStyle = INTERNAL_STROKE((internalAlpha * 0.12).toFixed(3));
    ctx.lineWidth   = WIDTH_BOUNDARY;
    ctx.stroke();
  }

  if (boundary.length) {
    ctx.beginPath();
    for (let i = 0; i < boundary.length; i += 4) {
      ctx.moveTo(boundary[i], boundary[i+1]);
      ctx.lineTo(boundary[i+2], boundary[i+3]);
    }
    ctx.strokeStyle = STROKE_BOUNDARY();
    ctx.lineWidth   = WIDTH_BOUNDARY;
    ctx.stroke();
  }
}

// ── Map interaction events ─────────────────────────────────────────────────────
canvas.addEventListener('contextmenu', function(e) {
  e.preventDefault();
});

canvas.addEventListener('wheel', function(e) {
  e.preventDefault();
  const rect   = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;
  const factor = e.deltaY > 0 ? 0.85 : 1.18;
  const newZ   = Math.max(0.3, Math.min(40, zoom * factor));
  panX = mx - originX - (mx - originX - panX) * (newZ / zoom);
  panY = my - originY - (my - originY - panY) * (newZ / zoom);
  zoom = newZ; render();
}, { passive: false });

let panning = false, px0 = 0, py0 = 0, panX0 = 0, panY0 = 0;
canvas.addEventListener('mousedown', e => {
  if (e.button === 1) { e.preventDefault(); panning = true; px0 = e.clientX; py0 = e.clientY; panX0 = panX; panY0 = panY; }
});
window.addEventListener('mousemove', e => { if (panning) { panX = panX0 + e.clientX - px0; panY = panY0 + e.clientY - py0; render(); } });
window.addEventListener('mouseup',   () => { panning = false; });
window.addEventListener('resize',    () => { computeLayout(); render(); });
