// ── Parliament state ───────────────────────────────────────────────────────────
let parlTab    = 'party'; // active tab: 'party' | 'intl' | 'nation'
let parlFilter = null;    // selected legend filter value

window.SEATS = [];

// ── Election layout config (populated from Election sheet) ─────────────────
// Set window.ELECTION_CONFIG before calling renderParliament().
// Example:
//   window.ELECTION_CONFIG = { arcAngle: 90, rows: 4, tailPct: 0.5 };
// arcAngle : arc sweep degrees (0=classroom, 180=semicircle, 240=horseshoe, 360=circle)
// rows     : fixed row count (0 = auto-solve for largest dots)
// tailPct  : 0–1 fraction of seats in straight tail columns vs arc
//            0 = pure arc, 1 = all in two Westminster-style columns
window.ELECTION_CONFIG = window.ELECTION_CONFIG || { arcAngle: 360, rows: 4, tailPct: 0 };

// ── Seat allocation from zone vote data ───────────────────────────────────────
function buildSeats() {
  window.SEATS = [];

  const zones  = window.ZONES || [];

  const intlColors = {};
  const groups     = window.GROUPS || {};
  PARTIES.forEach(p => {
    if (!p.intlGrp) return;
    if (groups[p.intlGrp]) {
      intlColors[p.intlGrp] = groups[p.intlGrp].color;
    } else if (!intlColors[p.intlGrp]) {
      intlColors[p.intlGrp] = p.color;
    }
  });

  zones.forEach(zone => {
    if (!zone.votes || !zone.seats) return;
    const voteEntries = Object.entries(zone.votes).filter(([,pct]) => pct >= 0.01);
    const totalVote   = voteEntries.reduce((s,[,p]) => s+p, 0);

    if (totalVote <= 0) {
      for (let i = 0; i < zone.seats; i++) {
        window.SEATS.push({ party: null, intlGrp: null, nation: zone.region, color: '#44444f', intlColor: '#44444f' });
      }
      return;
    }

    const quotas = voteEntries.map(([short, pct]) => {
      const party = PARTIES.find(p => p.short === short);
      return { party, short, quota: pct / totalVote * zone.seats };
    });
    if (!quotas.length) return;
    quotas.forEach(q => { q.seats = Math.floor(q.quota); q.rem = q.quota - q.seats; });
    let rem = zone.seats - quotas.reduce((s,q) => s+q.seats, 0);
    quotas.sort((a,b) => b.rem - a.rem);
    for (let i = 0; i < rem; i++) quotas[i % quotas.length].seats++;

    quotas.forEach(q => {
      for (let i = 0; i < q.seats; i++) {
        const p = q.party;
        window.SEATS.push({
          party:     p ? p.name    : q.short,
          short:     q.short,
          intlGrp:   p ? p.intlGrp : null,
          nation:    zone.region,
          province:  zone.name,
          color:     p ? p.color   : '#888',
          intlColor: p && p.intlGrp ? (intlColors[p.intlGrp] || p.color) : (p ? p.color : '#888'),
        });
      }
    });
  });

  // Sort by intl group order, then by party within group
  const intlOrder = {};
  let idx = 0;
  PARTIES.forEach(p => { if (p.intlGrp && intlOrder[p.intlGrp] === undefined) intlOrder[p.intlGrp] = idx++; });
  const partyOrder = {};
  PARTIES.forEach((p,i) => { partyOrder[p.short || p.name] = i; });

  window.SEATS.sort((a,b) => {
    const ai = a.intlGrp != null ? (intlOrder[a.intlGrp] ?? 999) : 999;
    const bi = b.intlGrp != null ? (intlOrder[b.intlGrp] ?? 999) : 999;
    if (ai !== bi) return ai - bi;
    return (partyOrder[a.short] ?? 999) - (partyOrder[b.short] ?? 999);
  });
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

  // ── Layout configuration ──────────────────────────────────────────────────
  // Read live from window.ELECTION_CONFIG each render.
  // Populated externally from the Election sheet cells:
  //   arcAngle : arc sweep degrees (0=classroom, 180=semicircle, 240=horseshoe, 360=circle)
  //   rows     : fixed row count (0 = auto)
  //   tailPct  : 0–1, fraction of seats in tangential tail columns vs the arc
  //              0=pure arc, 1=all seats in Westminster-style straight columns
  const cfg       = window.ELECTION_CONFIG || {};
  const arcDeg    = Number(cfg.arcAngle ?? 180);
  const fixedRows = Number(cfg.rows     ?? 0);
  const tailPct   = Math.max(0, Math.min(1, Number(cfg.tailPct ?? 0)));
  const PAD       = 8;

  // ── Derived geometry ───────────────────────────────────────────────────────
  // Arc midpoint points upward (canvas angle 3π/2). Arc sweeps symmetrically.
  // 360° = full circle (closed loop, no endpoint duplication).
  // Tails extend tangentially from each arc endpoint — not vertically.
  // The tangent direction at arcStart (going "away" from the arc) is arcStart - π/2.
  // The tangent direction at arcEnd   (going "away") is arcEnd   + π/2.

  const isCircle  = arcDeg >= 360;
  const arcSweep  = Math.min(arcDeg, 360) * Math.PI / 180;
  const arcMid    = 3 * Math.PI / 2;
  const arcStart  = arcMid - arcSweep / 2;
  const arcEnd    = arcMid + arcSweep / 2;

  // Tangent directions at the arc endpoints (pointing away from the arc body):
  // At arcStart, the arc goes CW (increasing θ). Tangent going "backward" = arcStart - π/2.
  // At arcEnd,   the arc goes CW. Tangent going "forward"  = arcEnd   + π/2.
  const leftTangentDir  = arcStart - Math.PI / 2;   // direction tails go from left end
  const rightTangentDir = arcEnd   + Math.PI / 2;   // direction tails go from right end

  // Split seats: tailPct fraction in tails, rest in arc.
  const tailTotal = isCircle ? 0 : Math.round(n * tailPct);
  const arcTotal  = n - tailTotal;
  const tailLeft  = tailTotal - Math.floor(tailTotal / 2);
  const tailRight = Math.floor(tailTotal / 2);

  // ── Bounding box (unit radius) ─────────────────────────────────────────────
  function bbox(dr_u, R) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const steps = 720;
    // Arc
    for (let k = 0; k <= steps; k++) {
      const theta = arcStart + arcSweep * k / steps;
      minX=Math.min(minX,Math.cos(theta)); maxX=Math.max(maxX,Math.cos(theta));
      minY=Math.min(minY,Math.sin(theta)); maxY=Math.max(maxY,Math.sin(theta));
    }
    // Tails: extend from arc endpoints in tangent direction
    if (tailTotal > 0 && R > 0) {
      const tailRows = Math.ceil(Math.max(tailLeft, tailRight) / R);
      const tailLen  = tailRows * dr_u;
      // Sample along each tail
      for (let k = 1; k <= tailRows; k++) {
        const t = k * dr_u;
        const lx = Math.cos(arcStart) + t * Math.cos(leftTangentDir);
        const ly = Math.sin(arcStart) + t * Math.sin(leftTangentDir);
        const rx = Math.cos(arcEnd)   + t * Math.cos(rightTangentDir);
        const ry = Math.sin(arcEnd)   + t * Math.sin(rightTangentDir);
        minX=Math.min(minX,lx,rx); maxX=Math.max(maxX,lx,rx);
        minY=Math.min(minY,ly,ry); maxY=Math.max(maxY,ly,ry);
      }
      // Also account for the R columns spread across radius
      const lx0 = Math.cos(arcStart), ly0 = Math.sin(arcStart);
      const rx0 = Math.cos(arcEnd),   ry0 = Math.sin(arcEnd);
      minX=Math.min(minX,lx0-dr_u*(R-1)); maxX=Math.max(maxX,rx0+dr_u*(R-1));
    }
    return { minX, maxX, minY, maxY, w: maxX-minX, h: maxY-minY };
  }

  // ── Solver ─────────────────────────────────────────────────────────────────
  let bestPositions = null, bestDr = 0;
  const Rmin = fixedRows > 0 ? fixedRows : 1;
  const Rmax = fixedRows > 0 ? fixedRows : 20;

  for (let R = Rmin; R <= Rmax; R++) {
    // Binary search for dr (normalised, rMax=1) so arc rows sum to arcTotal
    let lo = 0.001, hi = 1.0;
    for (let iter = 0; iter < 80; iter++) {
      const dr  = (lo + hi) / 2;
      const r0  = 1 - (R - 1) * dr;
      if (r0 <= 0) { hi = dr; continue; }
      let tot = 0;
      for (let i = 0; i < R; i++) {
        const r = r0 + i * dr;
        // 360° = closed loop: seats distributed evenly without endpoint duplication
        tot += Math.max(1, Math.round(r * arcSweep / dr));
      }
      if (tot > arcTotal) lo = dr; else hi = dr;
    }
    const dr_u = (lo + hi) / 2;
    const r0_u = 1 - (R - 1) * dr_u;
    if (r0_u <= 0) continue;

    // Arc seat counts per row
    const arcCounts = [];
    for (let i = 0; i < R; i++) {
      arcCounts.push(Math.max(1, Math.round((r0_u + i * dr_u) * arcSweep / dr_u)));
    }
    const arcGot = arcCounts.reduce((s,x) => s+x, 0);
    arcCounts[R-1] += arcTotal - arcGot;
    if (arcCounts[R-1] < 1) continue;

    // Scale to canvas
    const bb   = bbox(dr_u, R);
    const rMax = Math.min((W/2 - PAD) / (bb.w / 2), (H - PAD*2) / bb.h) * 0.94;
    if (rMax <= 0) continue;
    const dr   = dr_u * rMax;
    const r0   = r0_u * rMax;
    const cx   = W / 2;
    const cy   = PAD + rMax * (-bb.minY);

    if (dr <= bestDr) continue;
    bestDr = dr;

    // ── Arc positions, swept angularly ──────────────────────────────────────
    // Build grid [row][col] then zipper-sweep so parties form wedge shapes.
    const arcGrid = [];
    for (let i = 0; i < R; i++) {
      const r = r0 + i * dr, count = arcCounts[i];
      const row = [];
      for (let j = 0; j < count; j++) {
        // 360°: distribute evenly as a closed loop (no repeated endpoint)
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

    // ── Tail positions (tangential extension from arc endpoints) ─────────────
    // Each tail is R columns wide (matching arc rows), extending in the tangent
    // direction from the arc endpoint. Column c uses radius r0+c*dr.
    // Left tail: from (cx+r*cos(arcStart), cy+r*sin(arcStart)), going in leftTangentDir.
    // Right tail: from (cx+r*cos(arcEnd), cy+r*sin(arcEnd)), going in rightTangentDir.
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

  const positions = bestPositions || [];
  const dotR      = bestDr * 0.44;

  // ── Draw ───────────────────────────────────────────────────────────────────
  function isHighlighted(seat) {
    if (!parlFilter) return true;
    if (parlTab === 'party')  return seat.short   === parlFilter;
    if (parlTab === 'intl')   return seat.intlGrp === parlFilter;
    if (parlTab === 'nation') return seat.nation  === parlFilter;
    return true;
  }
  function seatColor(seat) {
    return parlTab === 'intl' ? seat.intlColor : seat.color;
  }
  function dimmedSeatColor() {
    return isDark() ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.12)';
  }

  for (const highlighted of [false, true]) {
    for (const pos of positions) {
      const seat = seats[pos.seatIdx];
      if (!seat) continue;
      const hi = isHighlighted(seat);
      if (hi !== highlighted) continue;
      // Draw hexagonal seat (flat-top orientation)
      ctx.beginPath();
      for (let h = 0; h < 6; h++) {
        const ha = Math.PI / 180 * (60 * h);   // flat-top: 0° = right
        const hx = pos.x + dotR * Math.cos(ha);
        const hy = pos.y + dotR * Math.sin(ha);
        h === 0 ? ctx.moveTo(hx, hy) : ctx.lineTo(hx, hy);
      }
      ctx.closePath();
      ctx.fillStyle = hi ? seatColor(seat) : dimmedSeatColor();
      ctx.fill();
    }
  }
}

// ── Parliament legend ──────────────────────────────────────────────────────────
function buildParlLegend() {
  const el = document.getElementById('parl-legend');
  if (!el) return;
  el.innerHTML = '';
  const seats = window.SEATS || [];
  let groups  = [];

  if (parlTab === 'party') {
    const map = {};
    seats.forEach(s => {
      const key = s.short || s.party || '?';
      if (!map[key]) map[key] = { name: s.party, short: s.short, color: s.color, count: 0 };
      map[key].count++;
    });
    groups = Object.values(map).sort((a,b) => b.count - a.count);
    groups.forEach(g => { g.key = g.short; });
  } else if (parlTab === 'intl') {
    const map  = {};
    const grps = window.GROUPS || {};
    seats.forEach(s => {
      const key = s.intlGrp || '—';
      if (!map[key]) {
        const grp = grps[key];
        map[key] = { name: grp ? grp.name : key, color: s.intlColor, count: 0 };
      }
      map[key].count++;
    });
    // Keep the short-code key on each group (matches seat.intlGrp and PARL_FILTER.value)
    groups = Object.keys(map).map(k => Object.assign({ key: k === '—' ? null : k }, map[k]));
    groups.sort((a,b) => b.count - a.count);
  } else if (parlTab === 'nation') {
    const map = {};
    seats.forEach(s => {
      const key = s.nation || '—';
      if (!map[key]) map[key] = { name: key, color: '#7a7a72', count: 0 };
      map[key].count++;
    });
    groups = Object.values(map).sort((a,b) => b.count - a.count);
    groups.forEach(g => { g.key = g.name; });
  }

  groups.forEach(g => {
    const item = document.createElement('div');
    item.className = 'pl-item' + (parlFilter === g.key ? ' active' : '');
    const sw = document.createElement('div'); sw.className = 'pl-swatch'; sw.style.background = g.color;
    const nm = document.createElement('div'); nm.className = 'pl-name'; nm.textContent = g.name || '—';
    const ct = document.createElement('div'); ct.className = 'pl-count'; ct.textContent = g.count;
    item.appendChild(sw); item.appendChild(nm); item.appendChild(ct);
    item.addEventListener('click', () => {
      parlFilter = (parlFilter === g.key) ? null : g.key;
      buildParlLegend(); renderParliament(); applyMapFilter();
    });
    el.appendChild(item);
  });
}

function applyMapFilter() {
  window.PARL_FILTER = { tab: parlTab, value: parlFilter };
  render();
}

// Public: called from the results list when a row is clicked.
// tab is 'party' or 'intl'. Toggles focus; clears if already active.
function toggleResultsFilter(key, tab) {
  const newTab = tab || 'party';
  if (parlTab === newTab && parlFilter === key) {
    parlFilter = null; // toggle off
  } else {
    parlTab    = newTab;
    parlFilter = key;
  }
  document.querySelectorAll('.ptab').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === parlTab);
  });
  buildParlLegend(); renderParliament();
  applyMapFilter();
}

// ── Tab switching ──────────────────────────────────────────────────────────────
document.querySelectorAll('.ptab').forEach(btn => {
  btn.addEventListener('click', () => {
    parlTab    = btn.dataset.tab;
    parlFilter = null;
    document.querySelectorAll('.ptab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    buildParlLegend(); renderParliament(); renderResults(); applyMapFilter(); render();
  });
});

new ResizeObserver(() => renderParliament()).observe(document.getElementById('parl-canvas-wrap'));
