// Pure formatting and odds conversion helpers. No DOM, no clock, no locale.
export const MINUS = '−';

function num(x) {
  return typeof x === 'number' && Number.isFinite(x);
}

// Trim a number to at most two decimals without a trailing ".0".
function trim(x) {
  const r = Math.round(Math.abs(x) * 100) / 100;
  return String(r);
}

export function fmtAmerican(a) {
  if (!num(a)) return '—';
  const r = Math.round(a);
  if (r === 100 || r === -100) return 'pk'; // Adam: +100 / -100 just say "pk" (a spread line of 0 stays "PK")
  if (r < 0) return MINUS + Math.abs(r);
  return '+' + r;
}

// Signed spread line: -3.5 -> "−3.5", 3.5 -> "+3.5", 0 -> "PK".
export function fmtLine(x) {
  if (!num(x)) return '—';
  if (Math.abs(x) < 1e-9) return 'PK';
  return (x < 0 ? MINUS : '+') + trim(x);
}

// Unsigned total number: 41.5 -> "41.5".
export function fmtTotalNum(x) {
  if (!num(x)) return '—';
  return trim(x);
}

// "O 41.5" / "U 41.5".
export function fmtTotal(x, side) {
  if (!num(x)) return '—';
  const s = side === 'under' || side === 'U' ? 'U' : 'O';
  return s + ' ' + trim(x);
}

// Probability 0..1 -> "52.4%".
export function fmtPct(p, digits = 1) {
  if (!num(p)) return '—';
  return (p * 100).toFixed(digits) + '%';
}

export function americanToDecimal(a) {
  if (!num(a) || a === 0) return null;
  return a > 0 ? 1 + a / 100 : 1 + 100 / Math.abs(a);
}

export function decimalToAmerican(d) {
  if (!num(d) || d <= 1) return null;
  if (d >= 2) return Math.round((d - 1) * 100);
  return -Math.round(100 / (d - 1));
}

export function americanToProb(a) {
  const d = americanToDecimal(a);
  return d ? 1 / d : null;
}

export function probToAmerican(p) {
  if (!num(p) || p <= 0 || p >= 1) return null;
  return decimalToAmerican(1 / p);
}

// Signed difference: +0.5 / −1.0 / "0".
export function fmtDelta(x, digits = 1) {
  if (!num(x)) return '—';
  if (Math.abs(x) < 0.5 * Math.pow(10, -digits)) return '0';
  return (x < 0 ? MINUS : '+') + Math.abs(x).toFixed(digits);
}

// Age in seconds -> "38s", "4m", "1h05".
export function fmtAge(s) {
  if (!num(s)) return '—';
  if (s < 90) return Math.max(0, Math.round(s)) + 's';
  if (s < 3600) return Math.round(s / 60) + 'm';
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return h + 'h' + String(m).padStart(2, '0');
}

// Milliseconds until an event -> "in 1h 12m", "in 8m", "now".
export function fmtCountdown(ms) {
  if (!num(ms)) return '';
  if (ms <= 0) return 'now';
  const m = Math.round(ms / 60000);
  if (m < 1) return 'in <1m';
  if (m < 60) return 'in ' + m + 'm';
  const h = Math.floor(m / 60);
  const r = m % 60;
  return 'in ' + h + 'h' + (r ? ' ' + r + 'm' : '');
}

// Price text in one of three display modes: odds | pct | both.
export function fmtPrice(american, mode = 'odds') {
  if (!num(american)) return '—';
  if (mode === 'pct') return fmtPct(americanToProb(american));
  if (mode === 'both') return fmtAmerican(american) + ' ' + fmtPct(americanToProb(american), 0);
  return fmtAmerican(american);
}

export function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---- slate day (D15): the day rolls over at 5:00 a.m. America/New_York, not midnight ----
const ET = 'America/New_York';
const ROLL_HOUR = 5;
const etParts = new Intl.DateTimeFormat('en-US', { timeZone: ET, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' });
const slateLabelFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });

function etWall(ms) {
  const o = {};
  for (const p of etParts.formatToParts(ms)) if (p.type !== 'literal') o[p.type] = +p.value;
  return o;
}

// Slate date as a UTC day number plus whether the clock is before the 5 a.m. rollover (wall-clock, so DST-safe).
function slateOf(ms) {
  const w = etWall(ms);
  const late = w.hour < ROLL_HOUR;
  const day = Math.floor(Date.UTC(w.year, w.month - 1, w.day) / 86400000) - (late ? 1 : 0);
  return { day, late };
}

// Slate day of an ISO start time relative to nowMs: {key:"2026-10-11", diff:0|1|-1|..., label, late}.
export function slateDay(isoStart, nowMs) {
  const t = typeof isoStart === 'number' ? isoStart : Date.parse(isoStart);
  if (!Number.isFinite(t)) return { key: '', diff: NaN, label: '', late: false };
  const s = slateOf(t);
  const n = slateOf(Number.isFinite(nowMs) ? nowMs : Date.now());
  const diff = s.day - n.day;
  const ms = s.day * 86400000;
  const label = diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : diff === -1 ? 'Yesterday' : slateLabelFmt.format(ms);
  return { key: new Date(ms).toISOString().slice(0, 10), diff, label, late: s.late };
}

const etTime = new Intl.DateTimeFormat('en-US', { timeZone: ET, hour: 'numeric', minute: '2-digit' });
const etTimeSec = new Intl.DateTimeFormat('en-US', { timeZone: ET, hour: 'numeric', minute: '2-digit', second: '2-digit' });

// "12:30 AM" in Eastern time, with " (late)" when the kickoff belongs to the previous slate day.
export function fmtSlateTime(isoStart, withLate = true) {
  const t = typeof isoStart === 'number' ? isoStart : Date.parse(isoStart);
  if (!Number.isFinite(t)) return '';
  return etTime.format(t) + (withLate && slateOf(t).late ? ' (late)' : '');
}

export function fmtEtClock(ms) {
  return etTimeSec.format(ms);
}

// ---- D18: a sportsbook spread or total at -110 shows the line only ----
export function isStandardJuice(american) {
  return num(american) && Math.round(american) === -110;
}

// True when the price is left out: sportsbook (kind "book") spread/total at exactly -110.
export function hidesPrice(market, kind, american) {
  return market !== 'moneyline' && kind === 'book' && isStandardJuice(american);
}
