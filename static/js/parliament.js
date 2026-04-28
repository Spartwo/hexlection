// ── Parliament state ───────────────────────────────────────────────────────────
let parlTab    = 'party'; // active tab: 'party' | 'intl' | 'nation'
let parlFilter = null;    // selected legend filter value

window.SEATS = [];

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
    quotas.forEach(q => { q.seats = Math.floor(q.quota); q.rem = q.quota - q.seats; });
    let rem = zone.seats - quotas.reduce((s,q) => s+q.seats, 0);
    quotas.sort((a,b) => b.rem - a.rem);
    for (let i = 0; i < rem; i++) quotas[i].seats++;

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

  // ── Hexagonal crown geometry ────────────────────────────────────────────────
  // Pointy-top regular hexagon. Corner i at angle (-90 + 60·i)°.
  //   i=0: top  i=1: upper-right  i=2: lower-right
  //   i=3: bottom  i=4: lower-left  i=5: upper-left
  //
  // Crown = 4 edges: Left[4→5], TopLeft[5→0], TopRight[0→1], Right[1→2]
  // outerR = circumradius; apothem = outerR·√3/2 (center-to-edge-midpoint)
  // Crown spans: width = 2·apothem, height = 1.5·outerR (top to lower side corners)
  const PAD    = 8;
  const outerR = Math.min((W / 2 - PAD) / (Math.sqrt(3) / 2), (H - PAD) / 1.5);
  const apo    = outerR * Math.sqrt(3) / 2;  // apothem
  const cx     = W / 2;
  const cy     = PAD + outerR;  // center is outerR below the top point

  const corner = i => {
    const a = Math.PI / 180 * (-90 + 60 * i);
    return { x: cx + outerR * Math.cos(a), y: cy + outerR * Math.sin(a) };
  };

  // ── Seat count split ────────────────────────────────────────────────────────
  // n4   = largest multiple of 4 ≤ n  → fills the 4 crown segments exactly equally.
  // rem  = n % 4  (0–3)               → placed in a 5th segment at the interior
  //                                     angle below the crown apex (corner 0).
  const rem = n % 4;
  const n4  = n - rem;           // seats for the 4 main segments (n4/4 each)
  const perSeg = n4 / 4;        // exact integer per segment — no surplus, no trimming

  // Solve for pitch p: largest p where one parallelogram segment holds ≥ perSeg seats.
  // Capacity = T rows × maxCols columns = floor(apo/p) × floor(outerR/p).
  let p = apo;
  let T, totalCap;

  for (let iter = 0; iter < 200; iter++) {
    p *= 0.97;
    T = Math.floor(apo / p);
    if (T < 1) continue;
    // Trapezoid: at depth d = (r+0.5)*p, the valid along-range shrinks by d/√3 on each side.
    // Valid columns at row r: floor((outerR - 2*(r+0.5)*p/√3) / p)
    totalCap = 0;
    for (let r = 0; r < T; r++) {
      const w = outerR - 2 * (r + 0.5) * p / Math.sqrt(3);
      totalCap += Math.max(0, Math.floor(w / p));
    }
    if (totalCap >= perSeg) break;
  }

  // Dot radius: derived from the diagonal nearest-neighbour distance (p·sin60°)
  // so dots never overlap even across rows in the tilted wedge geometry.
  const dotR = p * Math.sqrt(3) / 2 * 0.46;  // ≈ 46% of the tightest gap

  // ── Generate positions for all 4 segments, column by column left→right ──────
  // Crown edges (pointy-top hexagon, corners 0–5):
  //   Seg 0: Left      [4→5]   Seg 1: TopLeft  [5→0]
  //   Seg 2: TopRight  [0→1]   Seg 3: Right    [1→2]
  //
  // Each segment is a parallelogram swept column-by-column from its start corner.
  // Column c at along-offset (c+0.5)·p; row r at inward depth (r+0.5)·p.

  const positions = [];
  let seatIdx = 0;

  const edgeDefs = [[4,5],[5,0],[0,1],[1,2]];
  const segEdges = edgeDefs.map(([ci, cj]) => {
    const s = corner(ci), e = corner(cj);
    const dx = e.x - s.x, dy = e.y - s.y;
    const len = Math.hypot(dx, dy);
    const ax = dx / len, ay = dy / len;
    return { s, e, ax, ay, ix: -ay, iy: ax };
  });

  const maxCols = Math.floor(outerR / p);

  function segmentRows({ s, ax, ay, ix, iy }) {
    // Each segment is a trapezoid: wide at the outer edge, narrowing inward.
    // At depth d = (r+0.5)*p, the hex walls cut in by d/√3 on each side.
    // Valid width at row r: w(r) = outerR - 2*depth/√3.
    // Seats in that row: nCols = floor(w(r)/p), centred within the valid range.
    // Centering: the row spans [lo, hi] = [cut, outerR-cut]; we place nCols
    // seats evenly spaced starting from the centre outward so dots always fill
    // the full available width without gaps at the edges.
    const SQ3 = Math.sqrt(3);
    const rows = [];
    for (let r = 0; r < T; r++) {
      const depth  = (r + 0.5) * p;
      const cut    = depth / SQ3;
      const w      = outerR - 2 * cut;          // available width at this depth
      if (w <= 0) break;
      const nCols  = Math.floor(w / p);
      if (nCols <= 0) break;
      // Centre the nCols seats within [cut, outerR-cut]
      const span   = (nCols - 1) * p;
      const start  = (outerR / 2) - span / 2;  // midpoint of range minus half-span
      const row    = [];
      for (let c = 0; c < nCols; c++) {
        const alongPos = start + c * p;
        const x = s.x + ax * alongPos + ix * depth;
        const y = s.y + ay * alongPos + iy * depth;
        row.push({ x, y });
      }
      rows.push(row);
    }
    return rows;
  }

  // Fill each segment row-by-row (outermost row first) so the trapezoid
  // shape is visible: the wide outer rows fill first, then progressively
  // narrower inner rows, stopping when perSeg seats are placed.
  const segRows = segEdges.map(segmentRows);

  for (const rows of segRows) {
    let taken = 0;
    outer: for (const row of rows) {
      for (const pt of row) {
        if (taken >= perSeg) break outer;
        positions.push({ x: pt.x, y: pt.y, seatIdx: seatIdx++ });
        taken++;
      }
    }
  }

  // ── 5th segment: remainder seats below the crown apex (corner 0) ─────────────
  // The interior angle at corner 0 points straight downward (toward cy).
  // The bisector of segments 1 and 2 runs vertically from corner 0 downward.
  // We place rem seats (0–3) in a compact horizontal cluster just below the
  // innermost point of the crown tip, spaced by p and centred on cx.
  if (rem > 0) {
    // Remainder seats sit at the inner angle between Seg1 and Seg2, forming a
    // small upward-pointing triangle (^):
    //   rem=1 → single seat at the apex
    //   rem=2 → two seats side by side one row below the apex
    //   rem=3 → one seat at apex, two seats below (triangle ^)
    // The apex sits one half-pitch past the innermost main row, along the
    // bisector of corner 0 (straight downward from corner 0 toward cy).
    const c0     = corner(0);
    const apexY  = c0.y + T * p + 0.5 * p;   // tip of the triangle

    if (rem === 1) {
      positions.push({ x: cx, y: apexY, seatIdx: seatIdx++ });
    } else if (rem === 2) {
      // Two seats on the bottom row of the triangle, centred
      positions.push({ x: cx - p / 2, y: apexY, seatIdx: seatIdx++ });
      positions.push({ x: cx + p / 2, y: apexY, seatIdx: seatIdx++ });
    } else {
      // rem === 3: apex seat on top, two seats one row below
      positions.push({ x: cx,         y: apexY,     seatIdx: seatIdx++ });
      positions.push({ x: cx - p / 2, y: apexY + p * Math.sqrt(3) / 2, seatIdx: seatIdx++ });
      positions.push({ x: cx + p / 2, y: apexY + p * Math.sqrt(3) / 2, seatIdx: seatIdx++ });
    }
  }

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

  for (const highlighted of [false, true]) {
    for (const pos of positions) {
      const seat = seats[pos.seatIdx];
      if (!seat) continue;
      const hi = isHighlighted(seat);
      if (hi !== highlighted) continue;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, dotR, 0, Math.PI * 2);
      ctx.fillStyle = hi ? seatColor(seat) : 'rgba(255,255,255,0.07)';
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
