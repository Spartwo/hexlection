// ── Global UI state ────────────────────────────────────────────────────────────
let PARTIES    = [];
let modalDraft = [];

// ── Results panel ──────────────────────────────────────────────────────────────
function renderResults() {
  const zones      = window.ZONES || [];
  const totalSeats = zones.reduce((s, z) => s + z.seats, 0);
  const maj        = Math.floor((totalSeats || 1) / 2) + 1;
  const seats      = window.SEATS || [];
  const isIntl     = parlTab === 'intl';

  const list = document.getElementById('results-list-main');
  list.innerHTML = '';

  if (isIntl) {
    const byGroup = {};
    seats.forEach(s => {
      const key = s.intlGrp || '—';
      if (!byGroup[key]) {
        const grp = (window.GROUPS||{})[key];
        byGroup[key] = { name: grp ? grp.name : key, color: s.intlColor, count: 0 };
      }
      byGroup[key].count++;
    });
    Object.values(byGroup).sort((a,b) => b.count - a.count).forEach(g => {
      list.appendChild(_resultRow(g.color, g.name, g.count));
    });
  } else {
    const byParty = {};
    PARTIES.forEach(p => { byParty[p.short || p.name] = { name: p.name, color: p.color, count: 0 }; });
    seats.forEach(s => {
      const key = s.short || s.party;
      if (byParty[key]) byParty[key].count++;
    });
    Object.values(byParty).sort((a,b) => b.count - a.count).forEach(p => {
      list.appendChild(_resultRow(p.color, p.name, p.count));
    });
  }

  const assignedSeats = seats.filter(s => s.party).length;

  const totalMain = document.getElementById('total-main');
  if (totalMain) totalMain.innerHTML = '<strong>' + assignedSeats + '</strong> / ' + totalSeats + ' seats assigned';
  const majN = document.getElementById('maj-n-main');
  if (majN) majN.textContent = maj;
  const majFill = document.getElementById('maj-fill-main');
  if (majFill) majFill.style.width = Math.min(100, assignedSeats / maj * 100) + '%';

  // Keep legacy elements in sync
  const oldTotal = document.getElementById('total');
  if (oldTotal) oldTotal.innerHTML = '<strong>' + assignedSeats + '</strong> / ' + totalSeats + ' seats';
  const oldMajN  = document.getElementById('maj-n');
  if (oldMajN) oldMajN.textContent = maj;
  const oldFill  = document.getElementById('maj-fill');
  if (oldFill) oldFill.style.width = Math.min(100, assignedSeats / maj * 100) + '%';
}

function _resultRow(color, name, count) {
  const row = document.createElement('div');
  row.className = 'rrow' + (count > 0 ? ' has' : '');
  const sw = document.createElement('div'); sw.className = 'rsw'; sw.style.background = color;
  const nm = document.createElement('div'); nm.className = 'rname'; nm.textContent = name;
  const ct = document.createElement('div'); ct.className = 'rcount'; ct.textContent = count || '';
  row.appendChild(sw); row.appendChild(nm); row.appendChild(ct);
  return row;
}

// ── Tooltip ────────────────────────────────────────────────────────────────────
function flatHexPath(r) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 3 * i;
    pts.push((r + r * Math.cos(a)).toFixed(2) + ',' + (r + r * Math.sin(a)).toFixed(2));
  }
  return 'M' + pts.join('L') + 'Z';
}

function renderTooltip(zone) {
  document.getElementById('t-name').textContent   = zone.name;
  document.getElementById('t-region').textContent = zone.region || '';

  // Seat hex grid
  const grid = document.getElementById('t-hexgrid');
  grid.innerHTML = '';

  const voteEntries = Object.entries(zone.votes || {});
  const hasVotes    = voteEntries.some(([,pct]) => pct > 0);
  const mainParties = [];
  const otherVotes  = { id: '__other__', name: 'Other', color: '#666677', votes: 0 };

  voteEntries.forEach(([short, pct]) => {
    if (pct < 0.01) { otherVotes.votes += pct; return; }
    const party    = PARTIES.find(p => p.short === short);
    const grp      = party && party.intlGrp ? (window.GROUPS||{})[party.intlGrp] : null;
    const intlColor = grp ? grp.color : (party ? party.color : '#888');
    mainParties.push({ id: short, name: party ? party.name : short, color: party ? party.color : '#888', intlColor, votes: pct });
  });
  mainParties.sort((a,b) => b.votes - a.votes);

  const seatList = [];
  if (hasVotes) {
    const allocated = allocateSeats(mainParties, zone.seats);
    allocated.sort((a,b) => b.seats - a.seats).forEach(p => {
      for (let i = 0; i < p.seats; i++) {
        seatList.push({ color: p.color, intlColor: p.intlColor || p.color, name: p.name });
      }
    });
  } else {
    for (let i = 0; i < zone.seats; i++) seatList.push({ color: '#44444f', intlColor: '#44444f', name: 'No data' });
  }

  const intlGroups = {};
  if (parlTab === 'intl') {
    mainParties.forEach(p => {
      const party  = PARTIES.find(q => q.short === p.id);
      const grpKey = party ? party.intlGrp : null;
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
    poly.setAttribute('stroke', 'rgba(0,0,0,0.3)');
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
    if (!hex) { tip.style.display = 'none'; return; }
    const displayMap = (parlTab === 'intl') ? window.ZONE_DISPLAY_INTL : window.ZONE_DISPLAY;
    const zd   = displayMap && displayMap[hex];
    const zone = zd ? zd.zone : null;
    if (zone) {
      renderTooltip(zone);
    } else {
      document.getElementById('t-name').textContent = hex;
      document.getElementById('t-region').textContent = '';
      document.getElementById('t-hexgrid').innerHTML  = '';
      document.getElementById('t-votes').innerHTML    = '';
    }
    tip.style.display = 'block';
    tip.style.left    = Math.min(e.clientX + 14, window.innerWidth  - 210) + 'px';
    tip.style.top     = Math.min(e.clientY - 8,  window.innerHeight - 90)  + 'px';
  } else {
    tip.style.display = 'none';
  }
});
_canvas.addEventListener('mouseleave', () => { document.getElementById('tip').style.display = 'none'; });

// ── Party bar ──────────────────────────────────────────────────────────────────
function buildPartyBar() {
  // Intentionally empty — party bar is hidden in the current layout.
  // Re-implement here if the bar is ever re-enabled.
}

// ── Edit-parties modal ─────────────────────────────────────────────────────────
function openModal() {
  modalDraft = PARTIES.map(p => Object.assign({}, p));
  renderModalList();
  document.getElementById('modal-overlay').classList.add('open');
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
}

function renderModalList() {
  const el = document.getElementById('party-edit-list');
  el.innerHTML = '';
  modalDraft.forEach((p, i) => {
    const row = document.createElement('div'); row.className = 'per';
    const ci  = document.createElement('input'); ci.type = 'color'; ci.value = p.color;
    ci.addEventListener('input', function() { modalDraft[i].color = this.value; });
    const ni  = document.createElement('input'); ni.type = 'text'; ni.value = p.name; ni.placeholder = 'Party name';
    ni.addEventListener('input', function() { modalDraft[i].name = this.value; });
    const db  = document.createElement('button'); db.textContent = '×';
    db.addEventListener('click', () => { modalDraft.splice(i, 1); renderModalList(); });
    row.appendChild(ci); row.appendChild(ni); row.appendChild(db);
    el.appendChild(row);
  });
}

function saveModal() {
  PARTIES = modalDraft.map(p => Object.assign({}, p));
  closeModal();
  buildPartyBar(); renderResults(); render();
}

document.getElementById('modal-overlay').addEventListener('click', function(e) {
  if (e.target === document.getElementById('modal-overlay')) closeModal();
});