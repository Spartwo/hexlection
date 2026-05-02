// ── Global UI state ────────────────────────────────────────────────────────────
let PARTIES    = [];
let resultSort = 'seats'; // 'seats' | 'votes' | 'nation'

// ── Compute party/group actual vote counts: pop × turnout × vote% ───────────
function computeVoteTotals() {
  const zones = window.ZONES || [];
  const partyTotals = {};
  zones.forEach(zone => {
    const base = zone.pop * zone.turnout; // actual votes cast in this constituency
    Object.entries(zone.votes || {}).forEach(([short, pct]) => {
      partyTotals[short] = (partyTotals[short] || 0) + base * pct;
    });
  });
  return partyTotals;
}

// ── Format vote numbers in thousands ──────────────────────────────────────
function fmtVotes(n) {
  if (!n || n < 1) return '';
  return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
}

// ── Results panel ──────────────────────────────────────────────────────────────
function renderResults() {
  const seats      = window.SEATS || [];
  const isGroup    = parlTab === 'intl';
  const voteTotals = computeVoteTotals();

  // ── Sort dropdown ───────────────────────────────────────────────────────────
  const resultsCol = document.getElementById('results-col');
  let sortWrap = document.getElementById('results-sort-wrap');
  if (!sortWrap) {
    sortWrap = document.createElement('div');
    sortWrap.id = 'results-sort-wrap';
    sortWrap.className = 'results-sort-wrap';
    const sel = document.createElement('select');
    sel.id = 'results-sort-select';
    sel.className = 'results-sort-select';
    sortWrap.appendChild(sel);
    resultsCol.insertBefore(sortWrap, resultsCol.firstChild);
    sel.addEventListener('change', () => {
      resultSort = sel.value;
      renderResults();
    });
  }

  const sel = document.getElementById('results-sort-select');
  const sortOptions = isGroup
    ? [['seats','Sort: Seats'],['votes','Sort: Votes']]
    : [['seats','Sort: Seats'],['votes','Sort: Votes'],['nation','Sort: Nation']];

  // Rebuild options only when the set changes (party↔group switch)
  const existing = Array.from(sel.options).map(o => o.value).join(',');
  const wanted   = sortOptions.map(([v]) => v).join(',');
  if (existing !== wanted) {
    sel.innerHTML = '';
    sortOptions.forEach(([val, label]) => {
      const opt = document.createElement('option');
      opt.value = val; opt.textContent = label;
      sel.appendChild(opt);
    });
  }
  // Reset to seats if current sort is invalid for this tab
  if (isGroup && resultSort === 'nation') resultSort = 'seats';
  sel.value = resultSort;

  const list = document.getElementById('results-list-main');
  list.innerHTML = '';
  // Sync dimming state: arc hover sets PARL_HOVER, list row hover also sets it
  list.classList.toggle('is-hovering', !!(window.PARL_HOVER));

  if (isGroup) {
    const byGroup = {};
    // Seed with all known groups first so groups with 0 seats still appear
    Object.entries(window.GROUPS || {}).forEach(([key, grp]) => {
      byGroup[key] = { key, name: grp.name, color: grp.color, count: 0, votes: 0 };
    });
    seats.forEach(s => {
      if (!s.grp) return; // skip unallocated seats — they have no group
      const key = s.grp;
      if (!byGroup[key]) {
        const grp = (window.GROUPS||{})[key];
        byGroup[key] = { key, name: grp ? grp.name : key, color: grp ? grp.color : s.intlColor, count: 0, votes: 0 };
      }
      byGroup[key].count++;
    });
    // Aggregate vote counts per group
    PARTIES.forEach(p => {
      const key = p.grp;
      if (!key) return; // skip parties with no group
      if (byGroup[key] && voteTotals[p.short]) {
        byGroup[key].votes += voteTotals[p.short] || 0;
      }
    });
    const sorted = Object.values(byGroup).sort((a,b) => {
      if (resultSort === 'votes') return b.votes - a.votes;
      return b.count - a.count;
    });
    sorted.forEach(g => {
      const displayVal = resultSort === 'votes' ? fmtVotes(g.votes) : g.count;
      list.appendChild(_resultRow(g.color, g.name, g.count, displayVal, g.key, 'intl'));
    });
  } else {
    const byParty = {};
    PARTIES.forEach(p => {
      byParty[p.short || p.name] = {
        short: p.short || p.name, name: p.name, color: p.color,
        count: 0, nation: p.nation || '', votes: voteTotals[p.short] || 0
      };
    });
    seats.forEach(s => {
      const key = s.short || s.party;
      if (byParty[key]) byParty[key].count++;
    });
    const sorted = Object.values(byParty).sort((a,b) => {
      if (resultSort === 'votes') return b.votes - a.votes;
      if (resultSort === 'nation') {
        // Empty nation sorts to bottom
        const aN = a.nation || '', bN = b.nation || '';
        if (!aN && bN) return 1;
        if (aN && !bN) return -1;
        const nc = aN.localeCompare(bN);
        if (nc !== 0) return nc;
        return b.count - a.count;
      }
      return b.count - a.count;
    });
    sorted.forEach(p => {
      const displayVal = resultSort === 'votes'
        ? (p.votes > 0 ? fmtVotes(p.votes) : 0)
        : resultSort === 'nation'
          ? (p.nation || '')  // blank if no nation
          : p.count;
      list.appendChild(_resultRow(p.color, p.name, p.count, displayVal, p.short, 'party'));
    });
  }
}

function _resultRow(color, name, count, displayVal, shortKey, tabKey) {
  const row = document.createElement('div');
  const isActive = window.PARL_FILTER && window.PARL_FILTER.value === shortKey && window.PARL_FILTER.tab === tabKey;
  // Arc hover: parliament canvas is hovering over this party/group (but user hasn't clicked)
  const isArcHover = !isActive && window.PARL_HOVER && window.PARL_HOVER.value === shortKey && window.PARL_HOVER.tab === tabKey;
  row.className = 'rrow' + (count > 0 ? ' has' : '') + (isActive ? ' focused' : '') + (isArcHover ? ' arc-hover' : '');
  const nm = document.createElement('div'); nm.className = 'rname'; nm.textContent = name;
  const ct = document.createElement('div'); ct.className = 'rcount'; ct.textContent = displayVal != null ? displayVal : 0;
  row.appendChild(nm); row.appendChild(ct);
  if (shortKey) {
    row.style.cursor = 'pointer';
    row.addEventListener('mouseenter', () => {
      window.PARL_HOVER = { tab: tabKey, value: shortKey };
      document.getElementById('results-list-main').classList.add('is-hovering');
      renderParliament();
    });
    row.addEventListener('mouseleave', () => {
      window.PARL_HOVER = null;
      document.getElementById('results-list-main').classList.remove('is-hovering');
      renderParliament();
    });
    row.addEventListener('click', () => {
      window.PARL_HOVER = null; // clear hover before rebuild so it doesn't persist on new DOM
      document.getElementById('results-list-main').classList.remove('is-hovering');
      if (typeof toggleResultsFilter === 'function') toggleResultsFilter(shortKey, tabKey);
      renderResults();
    });
  }
  return row;
}

// ── Tooltip ────────────────────────────────────────────────────────────────────
function renderTooltip(zone) {
  document.getElementById('t-name').textContent   = zone.name;
  document.getElementById('t-region').textContent = zone.region || '';
  const turnoutEl = document.getElementById('t-turnout');
  if (turnoutEl) turnoutEl.textContent = zone.turnout > 0 ? (zone.turnout * 100).toFixed(1) + '%' : '';

  // Seat hex grid
  const grid = document.getElementById('t-hexgrid');
  grid.innerHTML = '';

  const voteEntries = Object.entries(zone.votes || {});
  const mainParties = [];
  const otherVotes  = { id: '__other__', name: 'Other', color: '#666677', votes: 0 };

  voteEntries.forEach(([short, pct]) => {
    if (pct < 0.01) { otherVotes.votes += pct; return; }
    const party    = PARTIES.find(p => p.short === short);
    const grp      = party && party.grp ? (window.GROUPS||{})[party.grp] : null;
    const intlColor = grp ? grp.color : (party ? party.color : '#888');
    mainParties.push({ id: short, name: party ? party.name : short, color: party ? party.color : '#888', intlColor, votes: pct });
  });
  mainParties.sort((a,b) => b.votes - a.votes);

  const seatList = (window.SEATS || [])
    .filter(seat => seat.constituency === zone.constituency)
    .map(seat => ({
      color: seat.color || '#44444f',
      intlColor: seat.intlColor || seat.color || '#44444f',
      name: seat.party || 'No data'
    }));
  while (seatList.length < zone.seats) {
    seatList.push({ color: '#44444f', intlColor: '#44444f', name: 'No data' });
  }

  const intlGroups = {};
  if (parlTab === 'intl') {
    mainParties.forEach(p => {
      const party  = PARTIES.find(q => q.short === p.id);
      const grpKey = party ? party.grp : null;
      const grp    = grpKey ? (window.GROUPS||{})[grpKey] : null;
      const key    = grpKey || '—';
      if (!intlGroups[key]) intlGroups[key] = { name: grp ? grp.name : (grpKey || '—'), color: grp ? grp.color : p.color, votes: 0 };
      intlGroups[key].votes += p.votes;
    });
  }

  seatList.forEach(seat => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '20'); svg.setAttribute('height', '18');
    svg.setAttribute('viewBox', '-1 -1 22 20');
    svg.style.cssText = 'display:block';
    const title = document.createElementNS('http://www.w3.org/2000/svg','title');
    title.textContent = seat.name; svg.appendChild(title);
    const cx = 10, cy = 9, hr = 9;
    const pts = Array.from({length:6}, (_,i) => {
      const a = Math.PI/3*i;
      return (cx + hr*Math.cos(a)).toFixed(2) + ',' + (cy + hr*Math.sin(a)).toFixed(2);
    }).join(' ');
    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    poly.setAttribute('points', pts);
    poly.setAttribute('fill', parlTab === 'intl' ? seat.intlColor : seat.color);
    poly.setAttribute('stroke', TIP_HEX_STROKE());
    poly.setAttribute('stroke-width', '1');
    svg.appendChild(poly);
    grid.appendChild(svg);
  });

  // Vote share list
  const vlist = document.getElementById('t-votes');
  vlist.innerHTML = '';

  if (parlTab === 'intl') {
    Object.values(intlGroups).sort((a,b) => b.votes - a.votes).forEach(g => {
      vlist.appendChild(_tvrow(g.color, g.name, g.votes));
    });
    if (otherVotes.votes > 0) vlist.appendChild(_tvrow('#666677', 'Other', otherVotes.votes, true));
    return;
  }

  mainParties.forEach(p => { vlist.appendChild(_tvrow(p.color, p.id, p.votes)); });
  if (otherVotes.votes > 0) vlist.appendChild(_tvrow(otherVotes.color, 'Other', otherVotes.votes, true));
}

function _tvrow(color, name, votes, isOther = false) {
  const row  = document.createElement('div'); row.className = 'tvrow' + (isOther ? ' other' : '');
  const left = document.createElement('div'); left.className = 'tvcol';
  const sw   = document.createElement('div'); sw.className = 'tvsw'; sw.style.background = color;
  const nm   = document.createElement('span'); nm.textContent = name;
  left.appendChild(sw); left.appendChild(nm);
  const pct = document.createElement('span'); pct.textContent = (votes * 100).toFixed(1) + '%';
  row.appendChild(left); row.appendChild(pct);
  return row;
}

// Tooltip canvas events
const _canvas = document.getElementById('map-canvas');
_canvas.addEventListener('mousemove', function(e) {
  const rect = _canvas.getBoundingClientRect();
  const hit  = toGrid(e.clientX - rect.left, e.clientY - rect.top);
  const tip  = document.getElementById('tip');
  if (hit && origColors) {
    const hex = origColors[hit.row] && origColors[hit.row][hit.col];
    if (!hex) { tip.style.display = 'none'; if (window.HOVERED_HEX) { window.HOVERED_HEX = null; render(); } return; }
    if (window.HOVERED_HEX !== hex) { window.HOVERED_HEX = hex; render(); }
    const displayMap = (parlTab === 'intl') ? window.ZONE_DISPLAY_INTL : window.ZONE_DISPLAY;
    const zd   = displayMap && displayMap[hex];
    const zone = zd ? zd.zone : null;
    if (zone) {
      renderTooltip(zone);
    } else {
      document.getElementById('t-name').textContent = hex;
      document.getElementById('t-region').textContent = '';
      const _to = document.getElementById('t-turnout'); if (_to) _to.textContent = '';
      document.getElementById('t-hexgrid').innerHTML  = '';
      document.getElementById('t-votes').innerHTML    = '';
    }
    tip.style.display = 'block';
    tip.style.left    = Math.min(e.clientX + 14, window.innerWidth  - 210) + 'px';
    tip.style.top     = Math.min(e.clientY - 8,  window.innerHeight - 90)  + 'px';
  } else {
    if (window.HOVERED_HEX) { window.HOVERED_HEX = null; render(); }
    tip.style.display = 'none';
  }
});
_canvas.addEventListener('mouseleave', () => {
  document.getElementById('tip').style.display = 'none';
  if (window.HOVERED_HEX) { window.HOVERED_HEX = null; render(); }
});

