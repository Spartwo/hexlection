// ── Constants ─────────────────────────────────────────────────────────────────
const SQRT3 = Math.sqrt(3);
const SCALE_X = 0.10;
const SCALE_Y = 0.10 * 1.5 / SQRT3;
const BLK = 40;
const MIN_TERRITORY_PX = 80;
const WIDTH_BOUNDARY   = 2.0;

function isDark() { return (document.documentElement.getAttribute('data-theme') || 'dark') === 'dark'; }
function FILL_UNASSIGNED()  { return isDark() ? '#23232a' : '#F1F1F1'; }
function STROKE_BOUNDARY()  { return isDark() ? 'rgba(255,255,255,0.80)' : 'rgba(0,0,0,0.55)'; }
function MAP_BG()           { return isDark() ? '#0d0d0d' : '#ffffff'; }
function INTERNAL_STROKE(a) { return isDark() ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`; }
function TIP_HEX_STROKE()   { return isDark() ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.18)'; }

// ── Status bar ─────────────────────────────────────────────────────────────────
function setStatus(msg, err) {
  const el = document.getElementById('url-status');
  if (!el) return;
  el.textContent = msg;
  el.style.color = err ? '#e63946' : 'var(--muted)';
}
