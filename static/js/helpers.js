// ── Constants ─────────────────────────────────────────────────────────────────
const SQRT3 = Math.sqrt(3);
const SCALE_X = 0.10;
const SCALE_Y = 0.10 * 1.5 / SQRT3;
const BLK = 40;
const MIN_TERRITORY_PX = 80;
const WIDTH_BOUNDARY = 2.5;

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
function STROKE_REGION_BOUNDARY() { return isDark() ? 'rgba(255,255,255,0.95)' : 'rgba(0,0,0,0.80)'; }
function turnoutFillColor(turnout) {
  const t = Math.max(0, Math.min(1, turnout || 0));
  if (t === 0) return FILL_UNASSIGNED();
  // Subtle monochrome: map 0.3–0.9 turnout range to 0–1, then apply a small
  // lightness shift toward the text colour (white in dark mode, black in light)
  const alpha = Math.max(0, Math.min(1, (t - 0.30) / 0.60)) * 0.22;
  const base  = hexToRgb(FILL_UNASSIGNED());
  if (!base) return FILL_UNASSIGNED();
  const target = isDark() ? { r: 255, g: 255, b: 255 } : { r: 0, g: 0, b: 0 };
  return rgbToHex({
    r: base.r + (target.r - base.r) * alpha,
    g: base.g + (target.g - base.g) * alpha,
    b: base.b + (target.b - base.b) * alpha,
  });
}
