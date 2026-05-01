// ── Parliament state ───────────────────────────────────────────────────────────
let parlTab    = 'party'; // active tab: 'party' | 'intl' | 'nation'
let parlFilter = null;    // selected (clicked) filter value
window.PARL_HOVER = null; // { tab, value } — transient hover (list row or arc)

window.SEATS = [];

// ── Election layout config (populated from Election sheet) ─────────────────
window.ELECTION_CONFIG = window.ELECTION_CONFIG || { arcAngle: 360, rows: 4, tailPct: 0 };

// ── Last-rendered positions for hit testing ────────────────────────────────
let _parlPositions = [];  // [{ x, y, seatIdx }] in CSS px
let _parlDotR      = 0;

// ── Seat loading from Results sheet ───────────────────────────────────────────
function buildSeats(resultRows = []) {
  window.SEATS = [];

  const zones  = window.ZONES || [];

  const intlColors = {};
  const groups     = window.GROUPS || {};
  PARTIES.forEach(p => {
    if (!p.grp) return;
    if (groups[p.grp]) {
      intlColors[p.grp] = groups[p.grp].color;
    } else if (!intlColors[p.grp]) {
      intlColors[p.grp] = p.color;
    }
  });

  const pushSeat = (party, short, zone, fallbackColor = '#888') => {
    window.SEATS.push({
      party:        party ? party.name    : short,
      short,
      grp:      party ? party.grp : null,
      nation:       zone ? zone.region : '',
      constituency: zone ? zone.constituency : '',
      color:        party ? party.color   : fallbackColor,
      intlColor:    party && party.grp ? (intlColors[party.grp] || party.color) : (party ? party.color : fallbackColor),
    });
  };

  const pushEmptySeats = (zone, count) => {
    for (let i = 0; i < count; i++) {
      window.SEATS.push({
        party: null,
        short: null,
        grp: null,
        nation: zone ? zone.region : '',
        constituency: zone ? zone.constituency : '',
        color: null,
        intlColor: null
      });
    }
  };

  if (resultRows && resultRows.length) {
    const resultKeys = Object.keys(resultRows[0]);
    const constituencyKey = findObjectKey(resultKeys, ['constituency','name'], 1);
    const seatsKey        = findObjectKey(resultKeys, ['seats'], 0);
    const fixedKeys = new Set([constituencyKey, seatsKey].filter(Boolean).map(k => k.trim()));
    const partyKeys = resultKeys.filter(k => !fixedKeys.has(k.trim()) && PARTIES.some(p => p.short === k.trim()));
    const zoneByConstituency = {};
    zones.forEach(zone => { zoneByConstituency[zone.constituency] = zone; });

    resultRows.forEach(row => {
      const constituency = cell(row, constituencyKey);
      const zone = zoneByConstituency[constituency] || { region: '', constituency };
      const declaredSeats = Math.max(0, Math.floor(parseNumberValue(row[seatsKey], zone.seats || 0)));
      let allocated = 0;

      partyKeys.forEach(k => {
        const short = k.trim();
        const party = PARTIES.find(p => p.short === short);
        const count = Math.max(0, Math.floor(parseNumberValue(row[k], 0)));
        allocated += count;
        for (let i = 0; i < count; i++) pushSeat(party, short, zone);
      });

      if (declaredSeats > allocated) pushEmptySeats(zone, declaredSeats - allocated);
    });

    sortSeats();
    return;
  }

  zones.forEach(zone => {
    if (zone.seats) pushEmptySeats(zone, zone.seats);
  });

  sortSeats();
}

function sortSeats() {
  const intlOrder = {};
  let idx = 0;
  PARTIES.forEach(p => { if (p.grp && intlOrder[p.grp] === undefined) intlOrder[p.grp] = idx++; });
  const partyOrder = {};
  PARTIES.forEach((p,i) => { partyOrder[p.short || p.name] = i; });

  window.SEATS.sort((a,b) => {
    const ai = a.grp != null ? (intlOrder[a.grp] ?? 999) : 999;
    const bi = b.grp != null ? (intlOrder[b.grp] ?? 999) : 999;
    if (ai !== bi) return ai - bi;
    return (partyOrder[a.short] ?? 999) - (partyOrder[b.short] ?? 999);
  });
}

// ── Resolve label info for a given tab+key ────────────────────────────────
function _parlLabelInfo(tab, key) {
  if (!key) return null;
  const seats = window.SEATS || [];
  const count = seats.filter(s => {
    if (tab === 'party') return s.short === key && s.party !== null;
    if (tab === 'intl')  return s.grp === key && s.party !== null;
    return false;
  }).length;
  let shortLabel = key, color = null;
  if (tab === 'intl') {
    const grp = (window.GROUPS || {})[key];
    if (grp) { color = grp.color; }
  } else {
    const p = PARTIES.find(p2 => (p2.short || p2.name) === key);
    if (p) { shortLabel = p.short || p.name; color = p.color; }
  }
  return { shortLabel, count, color };
}

// ── Parliament canvas render ───────────────────────────────────────────────────
function renderParliament() {
  const canvas = document.getElementById('parl-canvas');
  const wrap   = document.getElementById('parl-canvas-wrap');
  canvas.width  = wrap.clientWidth  * devicePixelRatio;
  canvas.height = wrap.clientHeight * devicePixelRatio;
  canvas.style.width  = wrap.clientWidth  + 'px';
  canvas.style.height = wrap.clientHeight + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(devicePixelRatio, devicePixelRatio);
  const W = wrap.clientWidth, H = wrap.clientHeight;
  ctx.clearRect(0, 0, W, H);

  const seats = window.SEATS;
  if (!seats || !seats.length) return;
  const n = seats.length;

  const cfg       = window.ELECTION_CONFIG || {};
  const arcDeg    = Number(cfg.arcAngle ?? 180);
  const fixedRows = Number(cfg.rows     ?? 0);
  const tailPct   = Math.max(0, Math.min(1, Number(cfg.tailPct ?? 0)));
  const PAD       = 8;

  const isCircle  = arcDeg >= 360;
  const arcSweep  = Math.min(arcDeg, 360) * Math.PI / 180;
  const arcMid    = 3 * Math.PI / 2;
  const arcStart  = arcMid - arcSweep / 2;
  const arcEnd    = arcMid + arcSweep / 2;

  const leftTangentDir  = arcStart - Math.PI / 2;
  const rightTangentDir = arcEnd   + Math.PI / 2;

  const tailTotal = isCircle ? 0 : Math.round(n * tailPct);
  const arcTotal  = n - tailTotal;
  const tailLeft  = tailTotal - Math.floor(tailTotal / 2);
  const tailRight = Math.floor(tailTotal / 2);

  function bbox(dr_u, R) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const steps = 720;
    for (let k = 0; k <= steps; k++) {
      const theta = arcStart + arcSweep * k / steps;
      minX=Math.min(minX,Math.cos(theta)); maxX=Math.max(maxX,Math.cos(theta));
      minY=Math.min(minY,Math.sin(theta)); maxY=Math.max(maxY,Math.sin(theta));
    }
    if (tailTotal > 0 && R > 0) {
      const tailRows = Math.ceil(Math.max(tailLeft, tailRight) / R);
      for (let k = 1; k <= tailRows; k++) {
        const t = k * dr_u;
        const lx = Math.cos(arcStart) + t * Math.cos(leftTangentDir);
        const ly = Math.sin(arcStart) + t * Math.sin(leftTangentDir);
        const rx = Math.cos(arcEnd)   + t * Math.cos(rightTangentDir);
        const ry = Math.sin(arcEnd)   + t * Math.sin(rightTangentDir);
        minX=Math.min(minX,lx,rx); maxX=Math.max(maxX,lx,rx);
        minY=Math.min(minY,ly,ry); maxY=Math.max(maxY,ly,ry);
      }
      const lx0 = Math.cos(arcStart), ly0 = Math.sin(arcStart);
      const rx0 = Math.cos(arcEnd),   ry0 = Math.sin(arcEnd);
      minX=Math.min(minX,lx0-dr_u*(R-1)); maxX=Math.max(maxX,rx0+dr_u*(R-1));
    }
    return { minX, maxX, minY, maxY, w: maxX-minX, h: maxY-minY };
  }

  let bestPositions = null, bestDr = 0;
  const Rmin = fixedRows > 0 ? fixedRows : 1;
  const Rmax = fixedRows > 0 ? fixedRows : 20;

  for (let R = Rmin; R <= Rmax; R++) {
    let lo = 0.001, hi = 1.0;
    for (let iter = 0; iter < 80; iter++) {
      const dr  = (lo + hi) / 2;
      const r0  = 1 - (R - 1) * dr;
      if (r0 <= 0) { hi = dr; continue; }
      let tot = 0;
      for (let i = 0; i < R; i++) {
        const r = r0 + i * dr;
        tot += Math.max(1, Math.round(r * arcSweep / dr));
      }
      if (tot > arcTotal) lo = dr; else hi = dr;
    }
    const dr_u = (lo + hi) / 2;
    const r0_u = 1 - (R - 1) * dr_u;
    if (r0_u <= 0) continue;

    const arcCounts = [];
    for (let i = 0; i < R; i++) {
      arcCounts.push(Math.max(1, Math.round((r0_u + i * dr_u) * arcSweep / dr_u)));
    }
    const arcGot = arcCounts.reduce((s,x) => s+x, 0);
    arcCounts[R-1] += arcTotal - arcGot;
    if (arcCounts[R-1] < 1) continue;

    const bb   = bbox(dr_u, R);
    const rMax = Math.min((W/2 - PAD) / (bb.w / 2), (H - PAD*2) / bb.h) * 0.94;
    if (rMax <= 0) continue;
    const dr   = dr_u * rMax;
    const r0   = r0_u * rMax;
    const cx   = W / 2;
    const cy   = PAD + rMax * (-bb.minY);

    if (dr <= bestDr) continue;
    bestDr = dr;

    const arcGrid = [];
    for (let i = 0; i < R; i++) {
      const r = r0 + i * dr, count = arcCounts[i];
      const row = [];
      for (let j = 0; j < count; j++) {
        const t     = isCircle ? j / count : (count === 1 ? 0.5 : j / (count - 1));
        const theta = arcStart + t * arcSweep;
        row.push({ x: cx + r * Math.cos(theta), y: cy + r * Math.sin(theta) });
      }
      arcGrid.push(row);
    }

    const pos = [];
    let si = 0;
    const maxCount = arcCounts[R - 1];
    for (let j = 0; j < maxCount; j++) {
      for (let i = 0; i < R; i++) {
        const row   = arcGrid[i];
        const clamp = Math.min(Math.round(j * (row.length - 1) / Math.max(1, maxCount - 1)), row.length - 1);
        const owner = row.length === 1 ? 0 : Math.round(clamp * (maxCount - 1) / (row.length - 1));
        if (owner === j) pos.push({ x: row[clamp].x, y: row[clamp].y, seatIdx: si++ });
      }
    }

    if (tailTotal > 0) {
      const leftSeats = [], rightSeats = [];
      for (let c = 0; c < R; c++) {
        const r    = r0 + c * dr;
        const lx0  = cx + r * Math.cos(arcStart);
        const ly0  = cy + r * Math.sin(arcStart);
        const rx0  = cx + r * Math.cos(arcEnd);
        const ry0  = cy + r * Math.sin(arcEnd);
        const ldx  = Math.cos(leftTangentDir);
        const ldy  = Math.sin(leftTangentDir);
        const rdx  = Math.cos(rightTangentDir);
        const rdy  = Math.sin(rightTangentDir);
        const lRem = tailLeft  - leftSeats.length;
        const rRem = tailRight - rightSeats.length;
        const lIn  = Math.ceil(lRem / (R - c));
        const rIn  = Math.ceil(rRem / (R - c));
        for (let k = 0; k < lIn && leftSeats.length  < tailLeft;  k++)
          leftSeats.push({ x: lx0 + (k+1)*dr*ldx, y: ly0 + (k+1)*dr*ldy });
        for (let k = 0; k < rIn && rightSeats.length < tailRight; k++)
          rightSeats.push({ x: rx0 + (k+1)*dr*rdx, y: ry0 + (k+1)*dr*rdy });
      }
      for (const pt of leftSeats)  pos.push({ ...pt, seatIdx: si++ });
      for (const pt of rightSeats) pos.push({ ...pt, seatIdx: si++ });
    }

    bestPositions = pos;
  }

  // Store for hit-testing by mouse events
  _parlPositions = bestPositions || [];
  _parlDotR      = bestDr * 0.44;

  const positions = _parlPositions;
  const dotR      = _parlDotR;

  // ── Active filter: clicked selection OR hover, with clicked taking priority ─
  const activeFilter = parlFilter
    ? { tab: parlTab, value: parlFilter }
    : (window.PARL_HOVER || null);

  // ── Draw ───────────────────────────────────────────────────────────────────
  function isHighlighted(seat) {
    if (!activeFilter) return true;
    if (activeFilter.tab === 'party')  return seat.short   === activeFilter.value;
    if (activeFilter.tab === 'intl')   return seat.grp === activeFilter.value;
    if (activeFilter.tab === 'nation') return seat.nation  === activeFilter.value;
    return true;
  }
  function seatColor(seat) {
    const c = parlTab === 'intl' ? seat.intlColor : seat.color;
    return c || emptyUnfilledColor();
  }
  function dimmedSeatColor() {
    return isDark() ? '#23232a' : '#dedad4';
  }
  function emptyUnfilledColor() {
    return isDark() ? '#23232a' : '#dedad4';
  }

  for (const highlighted of [false, true]) {
    for (const pos of positions) {
      const seat = seats[pos.seatIdx];
      if (!seat) continue;
      const hi = isHighlighted(seat);
      if (hi !== highlighted) continue;
      ctx.beginPath();
      for (let h = 0; h < 6; h++) {
        const ha = Math.PI / 180 * (60 * h);
        const hx = pos.x + dotR * Math.cos(ha);
        const hy = pos.y + dotR * Math.sin(ha);
        h === 0 ? ctx.moveTo(hx, hy) : ctx.lineTo(hx, hy);
      }
      ctx.closePath();
      ctx.fillStyle = hi ? seatColor(seat) : dimmedSeatColor();
      ctx.fill();
    }
  }

  // ── Highlight label — show for clicked selection or hover ──────────────────
  const labelSource = parlFilter
    ? { tab: parlTab, value: parlFilter }
    : window.PARL_HOVER;

  if (labelSource) {
    const info = _parlLabelInfo(labelSource.tab, labelSource.value);
    if (info && info.count > 0 && info.color) {
      const labelText = `${info.shortLabel}  ${info.count}`;
      const fontSize = Math.max(11, Math.min(18, W / 20));
      ctx.font = `600 ${fontSize}px "DM Sans", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = info.color;
      ctx.fillText(labelText, W / 2, H * 0.52);
    }
  }
}

// ── Arc hit test — nearest seat within a generous cutoff ─────────────────
function _parlHitTest(px, py) {
  const seats  = window.SEATS || [];
  const cutoff = _parlDotR * 3.5; // covers gaps between dots comfortably
  let bestDist = cutoff * cutoff;
  let bestSeat = null;
  for (const pos of _parlPositions) {
    const dx = px - pos.x, dy = py - pos.y;
    const d2 = dx*dx + dy*dy;
    if (d2 < bestDist) {
      bestDist = d2;
      bestSeat = seats[pos.seatIdx] || null;
    }
  }
  if (!bestSeat) return null;
  if (parlTab === 'party') return bestSeat.short   || null;
  if (parlTab === 'intl')  return bestSeat.grp || null;
  return null;
}

// ── Parliament canvas mouse events ─────────────────────────────────────────
(function() {
  const pc = document.getElementById('parl-canvas');

  pc.addEventListener('mousemove', function(e) {
    const rect = pc.getBoundingClientRect();
    const key  = _parlHitTest(e.clientX - rect.left, e.clientY - rect.top);
    const prev = window.PARL_HOVER ? window.PARL_HOVER.value : null;
    if (key !== prev) {
      window.PARL_HOVER = key ? { tab: parlTab, value: key } : null;
      pc.style.cursor = key ? 'pointer' : 'default';
      renderParliament();
      renderResults();
    }
  });

  pc.addEventListener('mouseleave', function() {
    if (window.PARL_HOVER) {
      window.PARL_HOVER = null;
      pc.style.cursor = 'default';
      renderParliament();
      renderResults();
    }
  });

  pc.addEventListener('click', function(e) {
    const rect = pc.getBoundingClientRect();
    const key  = _parlHitTest(e.clientX - rect.left, e.clientY - rect.top);
    if (key === null) return; // clicked empty space — do nothing
    toggleResultsFilter(key, parlTab);
    renderResults();
  });
})();

// ── Parliament legend ──────────────────────────────────────────────────────────
function applyMapFilter() {
  window.PARL_FILTER = { tab: parlTab, value: parlFilter };
  render();
}

// Public: called from the results list when a row is clicked.
function toggleResultsFilter(key, tab) {
  const newTab = tab || 'party';
  if (parlTab === newTab && parlFilter === key) {
    parlFilter = null;
  } else {
    parlTab    = newTab;
    parlFilter = key;
  }
  document.querySelectorAll('.ptab').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === parlTab);
  });
  renderParliament();
  applyMapFilter();
}

// ── Tab switching ──────────────────────────────────────────────────────────────
document.querySelectorAll('.ptab').forEach(btn => {
  btn.addEventListener('click', () => {
    parlTab    = btn.dataset.tab;
    parlFilter = null;
    window.PARL_HOVER = null;
    document.querySelectorAll('.ptab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderParliament(); renderResults(); applyMapFilter(); render();
  });
});

new ResizeObserver(() => renderParliament()).observe(document.getElementById('parl-canvas-wrap'));