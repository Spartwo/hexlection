// ── Constants ─────────────────────────────────────────────────────────────────
const SQRT3 = Math.sqrt(3);
const SCALE_X = 0.10;
const SCALE_Y = 0.10 * 1.5 / SQRT3;
const BLK = 40;
const MIN_TERRITORY_PX = 80;
const WIDTH_BOUNDARY   = 2.0;

function isDark() { return (document.documentElement.getAttribute('data-theme') || 'dark') === 'dark'; }
function FILL_UNASSIGNED()  { return isDark() ? '#23232a' : '#ffffff'; }
function STROKE_BOUNDARY()  { return isDark() ? 'rgba(255,255,255,0.80)' : 'rgba(0,0,0,0.55)'; }
function MAP_BG()           { return isDark() ? '#0d0d0d' : '#ffffff'; }
function INTERNAL_STROKE(a) { return isDark() ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`; }
function TIP_HEX_STROKE()   { return isDark() ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.18)'; }

// ── CSV parsing ────────────────────────────────────────────────────────────────
function parseCSV(text) {
  const rows = [];
  let row = [], cur = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], nx = text[i+1];
    if (inQ) {
      if (ch === '"' && nx === '"') { cur += '"'; i++; }
      else if (ch === '"') inQ = false;
      else cur += ch;
    } else {
      if (ch === '"') inQ = true;
      else if (ch === ',') { row.push(cur); cur = ''; }
      else if (ch === '\r' && nx === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; i++; }
      else if (ch === '\n' || ch === '\r') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else cur += ch;
    }
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

function csvToObjects(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) return [];
  const headers = rows[0];
  return rows.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i] !== undefined ? row[i] : ''; });
    return obj;
  });
}

// ── Colour utilities ───────────────────────────────────────────────────────────
function blendToWhite(hexColor, strength) {
  const r = parseInt(hexColor.slice(1,3),16);
  const g = parseInt(hexColor.slice(3,5),16);
  const b = parseInt(hexColor.slice(5,7),16);
  const t = 0.25 + strength * 0.75;
  return '#' + [
    Math.round(255 + (r-255)*t),
    Math.round(255 + (g-255)*t),
    Math.round(255 + (b-255)*t),
  ].map(v => v.toString(16).padStart(2,'0')).join('');
}

// ── Seat allocation — Largest Remainder (Hamilton) ────────────────────────────
// parties: [{id, color, votes}], totalSeats: int
// returns [{id, color, seats}]
function allocateSeats(parties, totalSeats) {
  const total = parties.reduce((s, p) => s + p.votes, 0);
  if (total <= 0 || totalSeats <= 0) return parties.map(p => ({ ...p, seats: 0 }));
  const quotas = parties.map(p => ({ ...p, quota: p.votes / total * totalSeats }));
  if (!quotas.length) return [];
  quotas.forEach(p => { p.seats = Math.floor(p.quota); p.rem = p.quota - p.seats; });
  let remaining = totalSeats - quotas.reduce((s, p) => s + p.seats, 0);
  quotas.sort((a, b) => b.rem - a.rem);
  for (let i = 0; i < remaining; i++) quotas[i % quotas.length].seats++;
  return quotas;
}

// ── Status bar ─────────────────────────────────────────────────────────────────
function setStatus(msg, err) {
  const el = document.getElementById('url-status');
  el.textContent = msg;
  el.style.color = err ? '#e63946' : 'var(--muted)';
}
