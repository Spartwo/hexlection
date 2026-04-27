// ── Global map state ───────────────────────────────────────────────────────────
const tState = {};
let selParty   = null;
let origColors = null;
let GRID_COLS  = 0, GRID_ROWS = 0;
let territoryCount = 0;

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
  Object.keys(tState).forEach(k => delete tState[k]);

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

  territoryCount = uniqueHex.size;
  document.getElementById('total').textContent = '0\u00a0/\u00a0' + territoryCount + ' assigned';
  document.getElementById('maj-n').textContent = Math.floor(territoryCount/2) + 1;
  setStatus('');
  computeLayout(); renderResults(); render();
}

// ── Map render ─────────────────────────────────────────────────────────────────
function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#0d0d0d';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
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
      const fillColor = zd ? zd.color : FILL_UNASSIGNED;

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

      if (!window._territoryLoops) window._territoryLoops = {};
      window._territoryLoops[hexColor] = loops;
    }
  }

  // ── Pass 1b: parliament filter overlay ────────────────────────────────────
  const pf = window.PARL_FILTER;
  if (pf && pf.value !== null && window._territoryLoops) {
    const matchColors = new Set();

    if (pf.tab === 'party' || pf.tab === 'nation') {
      (window.ZONES || []).forEach(zone => {
        if (!zone.color) return;
        let match = false;
        if (pf.tab === 'party')  match = zone.winner === pf.value;
        if (pf.tab === 'nation') match = zone.region === pf.value;
        if (match) matchColors.add(zone.color);
      });
    } else if (pf.tab === 'intl') {
      const matchProvinces = new Set();
      (window.SEATS || []).forEach(seat => {
        if (seat.intlGrp === pf.value) matchProvinces.add(seat.province);
      });
      (window.ZONES || []).forEach(zone => {
        if (zone.color && matchProvinces.has(zone.name)) matchColors.add(zone.color);
      });
    }

    ctx.save();
    for (const [hexColor, loops] of Object.entries(window._territoryLoops)) {
      if (matchColors.has(hexColor)) continue;
      ctx.beginPath();
      for (const loop of loops) {
        ctx.moveTo(loop[0].x, loop[0].y);
        for (let i = 1; i < loop.length; i++) ctx.lineTo(loop[i].x, loop[i].y);
        ctx.closePath();
      }
      ctx.fillStyle = 'rgba(13,13,13,0.65)';
      ctx.fill('evenodd');
    }
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
    ctx.strokeStyle = `rgba(255,255,255,${(internalAlpha * 0.12).toFixed(3)})`;
    ctx.lineWidth   = WIDTH_BOUNDARY;
    ctx.stroke();
  }

  if (boundary.length) {
    ctx.beginPath();
    for (let i = 0; i < boundary.length; i += 4) {
      ctx.moveTo(boundary[i], boundary[i+1]);
      ctx.lineTo(boundary[i+2], boundary[i+3]);
    }
    ctx.strokeStyle = STROKE_BOUNDARY;
    ctx.lineWidth   = WIDTH_BOUNDARY;
    ctx.stroke();
  }
}

// ── URL-based image loading ────────────────────────────────────────────────────
function loadFromURL() {
  const url = document.getElementById('url-input').value.trim();
  if (!url) return;
  setStatus('loading…');
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload  = () => processImage(img);
  img.onerror = () => {
    const i2 = new Image();
    i2.onload  = () => processImage(i2);
    i2.onerror = () => setStatus('load failed', true);
    i2.src = url;
  };
  img.src = url;
}

// ── Territory assignment ───────────────────────────────────────────────────────
function assignTerritory(hex, pid) {
  if (pid === null) delete tState[hex]; else tState[hex] = pid;
  renderResults(); render();
}

function clearAll() {
  Object.keys(tState).forEach(k => delete tState[k]);
  renderResults(); render();
}

// ── Map interaction events ─────────────────────────────────────────────────────
canvas.addEventListener('click', function(e) {
  const rect = canvas.getBoundingClientRect();
  const hit  = toGrid(e.clientX - rect.left, e.clientY - rect.top);
  if (!hit) return;
  const hex = origColors[hit.row] && origColors[hit.row][hit.col];
  if (hex) assignTerritory(hex, selParty);
});

canvas.addEventListener('contextmenu', function(e) {
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const hit  = toGrid(e.clientX - rect.left, e.clientY - rect.top);
  if (!hit) return;
  const hex = origColors[hit.row] && origColors[hit.row][hit.col];
  if (hex) assignTerritory(hex, null);
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

document.getElementById('url-input').addEventListener('keydown', e => { if (e.key === 'Enter') loadFromURL(); });




