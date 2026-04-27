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

// ── Arc geometry helpers ───────────────────────────────────────────────────────
// Upper 4 edges of a pointy-top hexagon (crown/chevron shape)
function hexUpperPath(cx, cy, radius) {
  const corner = i => {
    const a = Math.PI * (-90 + 60 * i) / 180;
    return { x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) };
  };
  return [corner(4), corner(5), corner(0), corner(1), corner(2)];
}

function segLengths(pts) {
  const segs = [];
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i-1].x, dy = pts[i].y - pts[i-1].y;
    segs.push(Math.sqrt(dx*dx + dy*dy));
  }
  return segs;
}

function pointAtDist(pts, segs, dist) {
  let walked = 0;
  for (let i = 0; i < segs.length; i++) {
    if (walked + segs[i] >= dist) {
      const t = (dist - walked) / segs[i];
      return {
        x: pts[i].x + (pts[i+1].x - pts[i].x) * t,
        y: pts[i].y + (pts[i+1].y - pts[i].y) * t
      };
    }
    walked += segs[i];
  }
  return pts[pts.length - 1];
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

  const dotR   = Math.max(2.5, Math.min(6, H / 16));
  const rowGap = dotR * 2.5;

  const Rbywidth  = (W / 2 - dotR * 2) / (Math.sqrt(3) / 2);
  const Rbyheight = (H - dotR * 3) / 1.5;
  const outerR    = Math.min(Rbywidth, Rbyheight);
  const cx = W / 2;
  const cy = H - dotR - outerR * 0.5;

  const minR    = outerR * 0.28;
  const numRows = Math.max(1, Math.floor((outerR - minR) / rowGap));
  const radii   = Array.from({length: numRows}, (_, i) => minR + i * rowGap);

  const rowPaths   = radii.map(r => hexUpperPath(cx, cy, r));
  const rowSegs    = rowPaths.map(pts => segLengths(pts));
  const rowLens    = rowSegs.map(segs => segs.reduce((a,b)=>a+b,0));
  const totalLen   = rowLens.reduce((a,b)=>a+b,0);
  const seatsPerRow = radii.map((_,i) => Math.round(n * rowLens[i] / totalLen));

  let total = seatsPerRow.reduce((a,b)=>a+b,0);
  let ri = 0;
  while (total < n) { seatsPerRow[ri++ % numRows]++; total++; }
  while (total > n) { seatsPerRow[(--ri + numRows) % numRows]--; total--; }

  // Build 2D grid of seat positions
  const grid = rowPaths.map((pts, row) => {
    const segs  = rowSegs[row];
    const len   = rowLens[row];
    const count = seatsPerRow[row];
    return Array.from({ length: count }, (_, s) => {
      const t = (s + 0.5) / count;
      return pointAtDist(pts, segs, t * len);
    });
  });

  const nCols = seatsPerRow[numRows - 1];

  const rowColMap = grid.map((rowSeats, row) => {
    const count = rowSeats.length;
    const map   = new Array(nCols).fill(null);
    for (let s = 0; s < count; s++) {
      const outerCol = Math.floor((s + 0.5) * nCols / count);
      map[outerCol] = s;
    }
    return map;
  });

  // Read column-first, outer→inner to form angular wedges
  const positions = [];
  let seatIdx = 0;
  for (let col = 0; col < nCols && seatIdx < n; col++) {
    for (let row = numRows - 1; row >= 0 && seatIdx < n; row--) {
      const innerSeat = rowColMap[row][col];
      if (innerSeat === null) continue;
      const pt = grid[row][innerSeat];
      positions.push({ x: pt.x, y: pt.y, seatIdx });
      seatIdx++;
    }
  }

  function isHighlighted(seat) {
    if (!parlFilter) return true;
    if (parlTab === 'party')  return seat.short   === parlFilter;
    if (parlTab === 'intl')   return seat.intlGrp === parlFilter;
    if (parlTab === 'nation') return seat.nation  === parlFilter;
    return true;
  }

  function seatColor(seat) {
    if (parlTab === 'intl') return seat.intlColor;
    return seat.color;
  }

  for (const highlighted of [false, true]) {
    for (const pos of positions) {
      const seat = seats[pos.seatIdx];
      const hi   = isHighlighted(seat);
      if (hi !== highlighted) continue;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, dotR - 0.5, 0, Math.PI * 2);
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
    groups = Object.values(map).sort((a,b) => b.count - a.count);
    groups.forEach(g => { g.key = g.name === '—' ? null : g.name; });
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
