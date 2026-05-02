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
let _parlCY        = 0;   // canvas-px Y of the arc centre
let _parlR0        = 0;   // innermost arc radius in canvas-px

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

  const partyByShortMap = {};
  PARTIES.forEach(p => { if (p.short) partyByShortMap[p.short] = p; });

  zones.forEach(zone => {
    if (!zone.seats) return;
    const winner = zone.winner ? partyByShortMap[zone.winner] : null;
    if (winner) {
      for (let i = 0; i < zone.seats; i++) pushSeat(winner, winner.short, zone);
    } else {
      pushEmptySeats(zone, zone.seats);
    }
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

    if (arcSweep > 0) {
      // Sample points along the arc itself
      const steps = 720;
      for (let k = 0; k <= steps; k++) {
        const theta = arcStart + arcSweep * k / steps;
        minX=Math.min(minX,Math.cos(theta)); maxX=Math.max(maxX,Math.cos(theta));
        minY=Math.min(minY,Math.sin(theta)); maxY=Math.max(maxY,Math.sin(theta));
      }
    } else {
      // Pure-tail (0° arc): arc start and end coincide at the bottom (arcMid).
      // Seed the bounding box from that single point so the tail extent dominates.
      const px = Math.cos(arcStart), py = Math.sin(arcStart);
      minX = maxX = px; minY = maxY = py;
    }

    if (effectiveTailTotal > 0 && R > 0) {
      const tailRows   = Math.ceil(Math.max(effectiveTailLeft, effectiveTailRight) / R);
      const r0_u_local = 1 - (R - 1) * dr_u;
      for (let c = 0; c < R; c++) {
        const r = r0_u_local + c * dr_u;
        if (r <= 0) continue;
        const lx0 = r * Math.cos(arcStart), ly0 = r * Math.sin(arcStart);
        const rx0 = r * Math.cos(arcEnd),   ry0 = r * Math.sin(arcEnd);
        for (let k = 1; k <= tailRows; k++) {
          const t = k * dr_u;
          const lx = lx0 + t * Math.cos(leftTangentDir);
          const ly = ly0 + t * Math.sin(leftTangentDir);
          const rx = rx0 + t * Math.cos(rightTangentDir);
          const ry = ry0 + t * Math.sin(rightTangentDir);
          minX=Math.min(minX,lx,rx); maxX=Math.max(maxX,lx,rx);
          minY=Math.min(minY,ly,ry); maxY=Math.max(maxY,ly,ry);
        }
        minX=Math.min(minX,lx0,rx0); maxX=Math.max(maxX,lx0,rx0);
        minY=Math.min(minY,ly0,ry0); maxY=Math.max(maxY,ly0,ry0);
      }
    }
    return { minX, maxX, minY, maxY, w: maxX-minX, h: maxY-minY };
  }

  let bestPositions = null, bestDr = 0, bestCY = H / 2, bestR0 = 0;
  const Rmin = fixedRows > 0 ? fixedRows : 1;
  const Rmax = fixedRows > 0 ? fixedRows : 20;

  // ── Bug fix 3 & 4: when arcTotal === 0 (0° arc or 100% tail) the normal
  // R-loop collapses because arcSweep/arcTotal is zero.  We bypass it and
  // size the layout purely from the tail columns needed.
  // When arcSweep is 0 every seat must live in the tail columns.
  // Recompute tail totals to include all seats in that case.
  const effectiveTailTotal = arcSweep === 0 ? n : tailTotal;
  const effectiveTailLeft  = arcSweep === 0 ? n - Math.floor(n / 2) : tailLeft;
  const effectiveTailRight = arcSweep === 0 ? Math.floor(n / 2) : tailRight;
  const effectiveArcTotal  = arcSweep === 0 ? 0 : arcTotal;

  const pureTail = arcSweep === 0 || (arcTotal === 0 && tailTotal > 0);

  for (let R = Rmin; R <= Rmax; R++) {
    // ── arc seat counts ────────────────────────────────────────────────────
    let dr_u, r0_u, arcCounts;

    if (pureTail) {
      // Size purely by tail depth: tailDepth rows of R lanes.
      const tailDepth = Math.ceil(Math.max(effectiveTailLeft, effectiveTailRight) / R);
      dr_u      = 1 / tailDepth;
      r0_u      = 1;
      arcCounts = [];
    } else {
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
        if (tot > effectiveArcTotal) lo = dr; else hi = dr;
      }
      dr_u = (lo + hi) / 2;
      r0_u = 1 - (R - 1) * dr_u;
      if (r0_u <= 0) continue;

      arcCounts = [];
      for (let i = 0; i < R; i++) {
        arcCounts.push(Math.max(1, Math.round((r0_u + i * dr_u) * arcSweep / dr_u)));
      }
      const arcGot = arcCounts.reduce((s,x) => s+x, 0);
      let residual = effectiveArcTotal - arcGot;
      // Distribute residual one seat at a time, outermost rows first, cycling
      // until fully consumed. Never lets any row drop below 1.
      for (let pass = 0; residual !== 0 && pass < arcTotal; pass++) {
        const i = (R - 1) - (pass % R);
        const delta = residual > 0 ? 1 : -1;
        if (arcCounts[i] + delta >= 1) { arcCounts[i] += delta; residual -= delta; }
      }
      if (arcCounts[R-1] < 1) continue;
    }

    const bb   = bbox(dr_u, R);
    // dotR = dr * 0.44 = dr_u * rMax * 0.44.  We want dotR <= BUF on every
    // side, so solve for rMax first without the dot offset, then subtract
    // the dot extent from available space and recompute.
    const EDGE  = PAD + 4;  // fixed pixel buffer between dot edge and box edge
    const DOT_K = 0.44;     // dot radius = dr * DOT_K
    // Available interior after fixed edge buffer (dot centres must stay inside)
    const availW = W - 2 * EDGE;
    const availH = H - 2 * EDGE;
    // rMax must satisfy: rMax * bb.w/2 + rMax*dr_u*DOT_K <= availW/2
    //                    rMax * bb.h   + rMax*dr_u*DOT_K*2 <= availH
    // => rMax <= availW/2 / (bb.w/2 + dr_u*DOT_K)
    // => rMax <= availH   / (bb.h   + dr_u*DOT_K*2)
    const rMaxW = bb.w > 0
      ? (availW / 2) / (bb.w / 2 + dr_u * DOT_K)
      : (availW / 2) / (dr_u * DOT_K || 1);
    const rMaxH = bb.h > 1e-6
      ? availH / (bb.h + dr_u * DOT_K * 2)
      : availH / Math.max(dr_u * DOT_K * 2, (R - 1) * dr_u + dr_u);
    const rMax  = Math.min(rMaxW, rMaxH);
    if (rMax <= 0) continue;
    const dr   = dr_u * rMax;
    const r0   = r0_u * rMax;
    const dotR_px = dr * DOT_K;
    const cx   = W / 2;
    // For flat (0° arc) layouts centre vertically; for arcs pin the top to PAD+dotR.
    const cy   = arcSweep === 0
      ? H / 2 - rMax * ((bb.minY + bb.maxY) / 2)
      : EDGE + dotR_px + rMax * (-bb.minY);

    if (dr <= bestDr) continue;
    bestDr = dr;
    bestCY = cy;
    bestR0 = r0;

    // ── Tail geometry ──────────────────────────────────────────────────────
    // The tail grows outward from each arc endpoint along the tangent direction.
    // We have R lateral lanes. Each lane's root sits perpendicular to the
    // tangent, spaced dr apart — i.e. shifted radially along the arc endpoint.
    // Lane 0 = innermost (smallest radius), lane R-1 = outermost, matching
    // the arc row ordering so seatIdx flows continuously across the full chart.
    //
    // Bug 2 fix: seats within each lane stack outward along the tangent (k=1,2,…)
    // giving vertical columns rather than horizontal rows.

    const ldx = Math.cos(leftTangentDir),  ldy = Math.sin(leftTangentDir);
    const rdx = Math.cos(rightTangentDir), rdy = Math.sin(rightTangentDir);

    const leftLanes  = [];  // leftLanes[c]  = [{x,y}, …] — lane c, seats outward
    const rightLanes = [];

    for (let c = 0; c < R; c++) {
      // Lane root = arc endpoint at the radius of arc row c
      const r   = r0 + c * dr;
      const lx0 = cx + r * Math.cos(arcStart);
      const ly0 = cy + r * Math.sin(arcStart);
      const rx0 = cx + r * Math.cos(arcEnd);
      const ry0 = cy + r * Math.sin(arcEnd);

      const lPlaced = leftLanes.reduce( (s,l) => s + l.length, 0);
      const rPlaced = rightLanes.reduce((s,l) => s + l.length, 0);
      const lIn     = Math.ceil((effectiveTailLeft  - lPlaced) / (R - c));
      const rIn     = Math.ceil((effectiveTailRight - rPlaced) / (R - c));

      const lLane = [], rLane = [];
      // k steps outward from the arc endpoint — vertical stacking
      for (let k = 1; lLane.length < lIn && lPlaced + lLane.length < effectiveTailLeft;  k++)
        lLane.push({ x: lx0 + k*dr*ldx, y: ly0 + k*dr*ldy });
      for (let k = 1; rLane.length < rIn && rPlaced + rLane.length < effectiveTailRight; k++)
        rLane.push({ x: rx0 + k*dr*rdx, y: ry0 + k*dr*rdy });

      leftLanes.push(lLane);
      rightLanes.push(rLane);
    }

    // ── Assign seatIdx: left lanes → arc → right lanes ────────────────────
    // Within the tail, sweep depth-row first (k=1,2,…) with all lanes (c)
    // in each row, matching how the arc sweeps rows within each angular column.
    // This makes party colour bands run vertically (column-wise) not horizontally.
    const pos = [];
    let si = 0;

    // Left tail depth: how many rows deep is the deepest lane?
    const leftDepth  = leftLanes.reduce((m,l) => Math.max(m, l.length), 0);
    const rightDepth = rightLanes.reduce((m,l) => Math.max(m, l.length), 0);

    // Left tail: depth-first from far end inward (k=leftDepth-1..0) so the row
    // closest to the arc gets the highest seatIdx values, matching the arc's
    // left-to-right party ordering flowing continuously into the tail.
    for (let k = leftDepth - 1; k >= 0; k--)
      for (let c = R - 1; c >= 0; c--)
        if (k < leftLanes[c].length)
          pos.push({ ...leftLanes[c][k], seatIdx: si++ });

    // Arc seats — column sweep across the arc
    if (!pureTail) {
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

      const maxCount = arcCounts[R - 1];
      for (let j = 0; j < maxCount; j++) {
        for (let i = 0; i < R; i++) {
          const row   = arcGrid[i];
          const clamp = Math.min(Math.round(j * (row.length - 1) / Math.max(1, maxCount - 1)), row.length - 1);
          const owner = row.length === 1 ? 0 : Math.round(clamp * (maxCount - 1) / (row.length - 1));
          if (owner === j) pos.push({ x: row[clamp].x, y: row[clamp].y, seatIdx: si++ });
        }
      }
    }

    // Right tail: c=R-1..0 within each depth row (outermost lane first).
    for (let k = 0; k < rightDepth; k++)
      for (let c = R - 1; c >= 0; c--)
        if (k < rightLanes[c].length)
          pos.push({ ...rightLanes[c][k], seatIdx: si++ });

    bestPositions = pos;
  }

  // Store for hit-testing by mouse events and label placement
  _parlPositions = bestPositions || [];
  _parlDotR      = bestDr * 0.44;
  _parlCY        = bestCY;
  _parlR0        = bestR0;

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
      // ── Two-line tooltip: shorthand (bold) + seat count (regular) ──────────
      // Visual width is fixed at targetW — each line scaled independently.
      // Gap is a fixed pixel distance between the actual glyph descender of
      // the name and the actual glyph ascender of the number.
      const shortText  = info.shortLabel;
      const countText  = String(info.count);
      const targetW    = W * 0.09;               // fixed rendered width
      const baseFontSz = Math.max(11, Math.min(18, W / 20));
      const gap        = baseFontSz * 0.3;       // fixed inter-glyph gap (px)

      // Measure natural widths at the base size
      ctx.font = `700 ${baseFontSz}px "DM Sans", sans-serif`;
      const shortNatW = ctx.measureText(shortText).width || 1;

      ctx.font = `400 ${baseFontSz}px "DM Sans", sans-serif`;
      const countNatW = ctx.measureText(countText).width || 1;

      // Each line gets its own font size so it fills exactly targetW
      const shortSz = baseFontSz * (targetW / shortNatW);
      const countSz = baseFontSz * (targetW / countNatW);

      // Measure actual glyph extents so the gap is between ink edges, not
      // between baseline-derived em-box edges.
      ctx.font = `700 ${shortSz}px "DM Sans", sans-serif`;
      const shortM   = ctx.measureText(shortText);
      const shortDescent = shortM.actualBoundingBoxDescent ?? shortSz * 0.2;

      ctx.font = `400 ${countSz}px "DM Sans", sans-serif`;
      const countM   = ctx.measureText(countText);
      const countAscent  = countM.actualBoundingBoxAscent  ?? countSz * 0.8;

      // Place baselines so: shortBaseline + shortDescent + gap + countAscent = countBaseline
      // Block top = shortBaseline - shortAscent; block bottom = countBaseline + countDescent.
      const shortAscent  = shortM.actualBoundingBoxAscent  ?? shortSz * 0.8;
      const countDescent = countM.actualBoundingBoxDescent ?? countSz * 0.2;

      // ── Vertical placement ─────────────────────────────────────────────────
      // The gap anchor is the geometric centre of the arc (_parlCY) — this is
      // the centre of the circle for full circles, and the chord midpoint for
      // hemicycles (below which the interior is open). Both lines grow away
      // from this point so the anchor itself never moves between parties.
      const gapCY = Math.min(
        Math.max(_parlCY, PAD + shortAscent + shortDescent + gap / 2),
        H - PAD - countAscent - countDescent - gap / 2
      );
      const shortBaseY  = gapCY - gap / 2 - shortDescent;
      const countBaseY  = gapCY + gap / 2 + countAscent;
      const cx          = W / 2;

      ctx.textAlign    = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle    = info.color;

      // Shorthand — top line
      ctx.font = `700 ${shortSz}px "DM Sans", sans-serif`;
      ctx.fillText(shortText, cx, shortBaseY);

      // Seat count — bottom line
      ctx.font = `400 ${countSz}px "DM Sans", sans-serif`;
      ctx.fillText(countText, cx, countBaseY);
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