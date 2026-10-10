// Color helpers: team accents with a contrast guard, book hues.

export function hexToRgb(hex) {
  let h = String(hex || '').replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function rgbToHex([r, g, b]) {
  const x = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return '#' + x(r) + x(g) + x(b);
}

function lin(c) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function luminance(rgb) {
  return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
}

export function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

export function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

const SURFACE = { dark: [21, 26, 34], light: [255, 255, 255] };

// Move a color toward white (dark theme) or black (light theme) until it reads on the surface.
export function readableOn(rgb, surface, min, dark) {
  const target = dark ? [255, 255, 255] : [0, 0, 0];
  let c = rgb;
  for (let i = 0; i < 12 && contrast(c, surface) < min; i++) c = mix(c, target, 0.15);
  return c;
}

// Pick the team's primary color, falling back to alt_color when the primary
// would disappear on the surface (near-black on dark, near-white on light).
export function teamColors(team, theme) {
  const dark = theme !== 'light';
  const surf = SURFACE[dark ? 'dark' : 'light'];
  const cands = [team && team.color, team && team.alt_color].map(hexToRgb).filter(Boolean);
  let pick = cands.find((c) => contrast(c, surf) >= 2.6);
  if (!pick) pick = cands[0] || (dark ? [120, 130, 150] : [90, 100, 120]);
  const stripe = contrast(pick, surf) >= 2.6 ? pick : readableOn(pick, surf, 2.6, dark);
  // Text color for the tinted pill: the accent, pushed until readable on its own tint.
  const tintBg = mix(surf, pick, 0.22);
  const text = readableOn(pick, tintBg, 4.5, dark);
  return { stripe: rgbToHex(stripe), text: rgbToHex(text), raw: rgbToHex(pick), rgb: pick };
}

// Raw (unguarded) team color for large header gradients: dark enough for white text.
export function headerColor(team) {
  const c = hexToRgb(team && team.color) || hexToRgb(team && team.alt_color) || [60, 70, 90];
  const alt = hexToRgb(team && team.alt_color);
  let pick = c;
  // near-white primaries make white text unreadable; use the alt color
  if (contrast(pick, [255, 255, 255]) < 2.2 && alt) pick = alt;
  if (contrast(pick, [255, 255, 255]) < 2.2) pick = mix(pick, [0, 0, 0], 0.5);
  // near-black primaries vanish on dark UI; lift slightly
  if (luminance(pick) < 0.012) pick = mix(pick, [255, 255, 255], 0.14);
  return rgbToHex(pick);
}

// One hue per operator so a sportsbook and its prediction product share a color family
// without ever being merged (they differ by chip shape).
const OPERATOR_HUES = {
  DraftKings: '#53b848',
  FanDuel: '#1493ff',
  BetMGM: '#c4a14a',
  Caesars: '#d9b45a',
  bet365: '#2aa5b3',
  'Rush Street': '#2b8cd6',
  'Hard Rock': '#a77be0',
  Fanatics: '#7f86ee',
  Bovada: '#d45fc4',
  Pinnacle: '#d9a35c',
  Kalshi: '#26c6a2',
  Polymarket: '#4d7cff',
  Novig: '#8bc34a',
  ProphetX: '#d46ad6',
  BetOpenly: '#40b0d0',
};

export function operatorHue(operator, id) {
  if (OPERATOR_HUES[operator]) return OPERATOR_HUES[operator];
  let h = 0;
  const s = String(operator || id || 'x');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return 'hsl(' + h + ' 55% 60%)';
}

// Movement-chart line palette: never green or red, so a line is not mistaken for good or bad.
export const LINE_PALETTE = ['#5b8def', '#c78ae0', '#35bfd0', '#e08ab8', '#9aa7ff', '#e0b866', '#7fd0e8', '#b58cf0', '#d9a35c', '#6fa8dc', '#e6a6d6', '#8fb0c9', '#f0d27a'];

// True when a team's logo (usually its primary color) would melt into the surface, so it gets a 1px ring.
export function needsRing(team, theme) {
  const surf = SURFACE[theme === 'light' ? 'light' : 'dark'];
  const cs = [team && team.color, team && team.alt_color].map(hexToRgb).filter(Boolean);
  if (!cs.length) return false;
  return cs.some((c) => contrast(c, surf) < 2.2);
}
