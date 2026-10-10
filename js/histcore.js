// Pure helpers for the line-history chart. No DOM, no clock, no storage; times are epoch seconds.
import { slateDay } from './format.js';

export const RANGES = [
  ['24h', '24h'],
  ['3d', '3d'],
  ['all', 'All'],
];

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function clock(d) {
  const h = d.getHours();
  const m = d.getMinutes();
  return (h % 12 || 12) + ':' + String(m).padStart(2, '0') + ' ' + (h < 12 ? 'AM' : 'PM');
}

// "Thu 9:12 AM"; "Today 9:12 AM" on the same local day as nowSec; "Oct 4 9:12 AM" beyond six days.
export function fmtMoveTime(t, nowSec) {
  const d = new Date(t * 1000);
  const n = new Date((nowSec == null ? t : nowSec) * 1000);
  if (slateDay(t * 1000, (nowSec == null ? t : nowSec) * 1000).diff === 0) return 'Today ' + clock(d); // slate day, D15
  if (nowSec != null && Math.abs(nowSec - t) > 6 * 86400) return MONTHS[d.getMonth()] + ' ' + d.getDate() + ' ' + clock(d);
  return DAYS[d.getDay()] + ' ' + clock(d);
}

// Last point of a time-sorted series whose time is <= t, else null.
export function stepAt(series, t) {
  let hit = null;
  for (const p of series) {
    if (p[0] <= t) hit = p;
    else break;
  }
  return hit;
}

export function inGap(gaps, t) {
  for (const g of gaps || []) if (t >= g[0] && t <= g[1]) return g;
  return null;
}

// The stretches of [t0,t1] that are not inside a gap.
export function complementIntervals(t0, t1, gaps) {
  const gs = (gaps || [])
    .map((g) => [Math.max(t0, g[0]), Math.min(t1, g[1])])
    .filter((g) => g[1] > g[0])
    .sort((a, b) => a[0] - b[0]);
  const out = [];
  let at = t0;
  for (const g of gs) {
    if (g[0] > at) out.push([at, g[0]]);
    at = Math.max(at, g[1]);
  }
  if (at < t1) out.push([at, t1]);
  return out;
}

// American odds on a continuous "cents" scale: -110 -> -10, +100 -> 0, +105 -> 5.
export function centsOf(a) {
  if (typeof a !== 'number' || !Number.isFinite(a)) return null;
  return a >= 100 ? a - 100 : a + 100;
}

// A change worth listing: a new line for spread/total, a 10-cent price move for the moneyline.
export function isMove(market, prev, cur) {
  if (market === 'moneyline') {
    const a = centsOf(prev.american);
    const b = centsOf(cur.american);
    return a != null && b != null && Math.abs(b - a) >= 10;
  }
  if (prev.line == null || cur.line == null) return false;
  return Math.abs(cur.line - prev.line) > 1e-9;
}

// First data point of the live series (consensus; Kalshi's own points when there is no consensus),
// then each qualifying change. Entries: {t, line, american, first?}. The opening line is ignored.
export function keyMoves(data, market) {
  const out = [];
  let pts = (data && data.consensus) || [];
  if (!pts.length && data && data.kalshi && data.kalshi.length) pts = data.kalshi.map((p) => [p[0], p[1], p[3]]);
  let last = null;
  for (const p of pts) {
    const cur = { t: p[0], line: p[1], american: p[2] };
    if (!last) {
      last = cur;
      out.push({ ...cur, first: true });
    } else if (isMove(market, last, cur)) {
      last = cur;
      out.push(cur);
    }
  }
  return out;
}

// Step line through [t, value] points, held flat until tEnd. X and Y map data to pixels.
export function stepPath(pts, X, Y, tEnd) {
  if (!pts.length) return '';
  let d = '';
  pts.forEach((p, i) => {
    d += i === 0 ? `M${X(p.t).toFixed(1)} ${Y(p.v).toFixed(1)}` : `H${X(p.t).toFixed(1)}V${Y(p.v).toFixed(1)}`;
  });
  return d + `H${X(Math.max(tEnd, pts[pts.length - 1].t)).toFixed(1)}`;
}

// Straight-line paths, one per run of points that no gap separates.
export function splitByGaps(pts, gaps) {
  const runs = [];
  let cur = [];
  for (const p of pts) {
    const prev = cur[cur.length - 1];
    if (prev && (gaps || []).some((g) => prev.t <= g[1] && p.t >= g[0] && (prev.t < g[0] || p.t > g[1]))) {
      runs.push(cur);
      cur = [];
    }
    cur.push(p);
  }
  if (cur.length) runs.push(cur);
  return runs;
}

// Round tick values covering [lo,hi]: returns {ticks, lo, hi} with lo/hi snapped to the outer ticks.
export function niceTicks(lo, hi, n = 5) {
  if (!(hi > lo)) {
    lo -= 0.5;
    hi += 0.5;
  }
  const rough = (hi - lo) / n;
  const steps = [0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100];
  const step = steps.find((s) => s >= rough) || 100;
  const a = Math.floor(lo / step + 1e-9) * step;
  const b = Math.ceil(hi / step - 1e-9) * step;
  const ticks = [];
  for (let v = a; v <= b + 1e-9; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return { ticks, lo: ticks[0], hi: ticks[ticks.length - 1], step };
}

// Domain from a list of values, padded, never narrower than minSpan.
export function domainFor(vals, minSpan, n = 5) {
  const v = vals.filter((x) => typeof x === 'number' && Number.isFinite(x));
  if (!v.length) return niceTicks(0, 1, n);
  let lo = Math.min(...v);
  let hi = Math.max(...v);
  if (hi - lo < minSpan) {
    const mid = (hi + lo) / 2;
    lo = mid - minSpan / 2;
    hi = mid + minSpan / 2;
  }
  const pad = (hi - lo) * 0.1;
  return niceTicks(lo - pad, hi + pad, n);
}

// Time axis ticks aligned to local hours/days: [{t, label, major}].
export function timeTicks(t0, t1, max = 6) {
  const span = t1 - t0;
  if (!(span > 0)) return [];
  const H = 3600;
  const steps = [H, 2 * H, 3 * H, 6 * H, 12 * H, 86400, 2 * 86400, 7 * 86400];
  const step = steps.find((s) => span / s <= max) || steps[steps.length - 1];
  const off = -new Date(t0 * 1000).getTimezoneOffset() * 60;
  const out = [];
  for (let t = Math.ceil((t0 + off) / step) * step - off; t <= t1; t += step) {
    const d = new Date(t * 1000);
    const midnight = d.getHours() === 0 && d.getMinutes() === 0;
    let label;
    if (step >= 86400) label = DAYS[d.getDay()] + ' ' + (d.getMonth() + 1) + '/' + d.getDate();
    else if (midnight) label = DAYS[d.getDay()];
    else label = (d.getHours() % 12 || 12) + (d.getHours() < 12 ? ' AM' : ' PM');
    out.push({ t, label, major: midnight });
  }
  return out;
}

// Where a held value stops: the start of the next gap after t, else tEnd.
export function runEnd(gaps, t, tEnd) {
  let e = tEnd;
  for (const g of gaps || []) if (g[0] > t && g[0] < e) e = g[0];
  return e;
}

// Hatched-band wording by gap reason: [t0, t1, "idle" | "no fresh consensus"].
export function gapLabel(g) {
  return g && g[2] === 'no fresh consensus' ? 'No fresh consensus line' : 'LineShop was idle';
}
