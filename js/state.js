// Shared state, settings, selectors and ingest logic.
import { scoreGame } from './fuzzy.js';
import { americanToDecimal, slateDay, fmtSlateTime, fmtEtClock } from './format.js';

export const MARKETS = ['spread', 'moneyline', 'total'];
export const MARKET_LABEL = { spread: 'Spread', moneyline: 'Moneyline', total: 'Total' };

// Soccer calls the spread a handicap.
export function mktLabel(m, lg) {
  if (m === 'spread' && lg && S.leagueById[lg] && S.leagueById[lg].three_way) return 'Handicap';
  return MARKET_LABEL[m];
}

export const S = {
  mock: false,
  meta: null,
  books: [],
  bookById: {},
  leagueById: {},
  league: 'nfl',
  win: 'all',
  view: 'board',
  market: 'spread',
  display: 'odds',
  theme: 'dark',
  query: '',
  boards: {}, // league -> Map(game_id -> summary)
  boardLoaded: {},
  index: [],
  sources: [],
  details: {}, // game_id -> GameDetail
  sel: null, // open drawer game id
  tab: 'spread',
  cursor: -1,
  flashes: new Map(),
  conn: 'ok',
  hiddenBooks: new Set(),
  sort: { key: 'time', dir: 1 },
  clockOffset: 0,
  gone: new Set(),
  fullSearch: false,
};

const KEY = 'lineshop.settings.v1';

export function loadSettings() {
  try {
    const o = JSON.parse(localStorage.getItem(KEY) || '{}');
    if (o.theme === 'light' || o.theme === 'dark') S.theme = o.theme;
    if (['odds', 'pct', 'both'].includes(o.display)) S.display = o.display;
    if (['board', 'grid'].includes(o.view)) S.view = o.view;
    if (['spread', 'moneyline', 'total', 'all'].includes(o.market)) S.market = o.market;
    if (['soon', 'today', '24h', 'all'].includes(o.win)) S.win = o.win;
    if (typeof o.league === 'string') S.league = o.league;
    if (Array.isArray(o.hidden)) S.hiddenBooks = new Set(o.hidden);
  } catch (e) {
    /* storage unavailable */
  }
}

export function saveSettings() {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        theme: S.theme, display: S.display, view: S.view, market: S.market,
        win: S.win, league: S.league, hidden: [...S.hiddenBooks],
      }),
    );
  } catch (e) {
    /* storage unavailable */
  }
}

export function now() {
  return Date.now() + S.clockOffset;
}

export function startMs(g) {
  const t = Date.parse(g.start);
  return Number.isFinite(t) ? t : 0;
}

export function setMeta(meta) {
  S.meta = meta;
  // D23: prediction markets come first everywhere (grid columns, Books menu), each group in the server's order.
  const pmRank = (b) => (b.kind === 'prediction' ? 0 : 1);
  S.books = (meta.books || []).slice().sort((a, b) => pmRank(a) - pmRank(b) || a.order - b.order);
  S.bookById = {};
  for (const b of S.books) S.bookById[b.id] = b;
  S.leagueById = {};
  for (const l of meta.leagues || []) S.leagueById[l.id] = l;
  if (!S.leagueById[S.league] && meta.leagues && meta.leagues.length) S.league = meta.leagues[0].id;
}

export function bookInfo(id) {
  return S.bookById[id] || { id, label: id, short: String(id).toUpperCase(), kind: 'book', operator: id };
}

export function leagueAccent(id) {
  return (S.leagueById[id] && S.leagueById[id].accent) || '#7d8aa3';
}

export function isThreeWay(lg) {
  return !!(S.leagueById[lg] && S.leagueById[lg].three_way);
}

// ---- team abbreviations: where two teams in one league share an abbreviation (MAN), use a derived one ----
let abbrDirty = true;
let altAbbr = new Map();

function derive(team) {
  const words = String(team.short || team.name || team.abbr).replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[words.length - 1].slice(0, 2)).toUpperCase();
  return (words[0] || team.abbr).slice(0, 3).toUpperCase();
}

function rebuildAbbr() {
  abbrDirty = false;
  const byKey = new Map();
  const add = (lg, t) => {
    if (!t || !t.abbr) return;
    const k = lg + '|' + t.abbr;
    if (!byKey.has(k)) byKey.set(k, new Map());
    byKey.get(k).set(t.name, t);
  };
  for (const lg of Object.keys(S.boards)) for (const g of S.boards[lg].values()) { add(lg, g.home); add(lg, g.away); }
  for (const g of S.index) { add(g.league, g.home); add(g.league, g.away); }
  altAbbr = new Map();
  for (const teams of byKey.values()) {
    if (teams.size < 2) continue;
    for (const [name, t] of teams) altAbbr.set(name, derive(t));
  }
}

export function abbrFor(team) {
  if (!team) return '';
  if (abbrDirty) rebuildAbbr();
  return altAbbr.get(team.name) || team.abbr;
}

// ---- price helpers -------------------------------------------------------
export function cellPrice(c) {
  if (!c) return null;
  return c.american;
}

export function cellDecimal(c) {
  if (!c) return null;
  return c.decimal != null ? c.decimal : americanToDecimal(c.american);
}

export function isBest(c) {
  return !!c && c.best_raw;
}

export function isNear(c) {
  return !!c && c.near_raw;
}

export function pickFor(game, market, side) {
  const b = game && game.best && game.best.raw;
  return (b && b[market] && b[market][side]) || null;
}

// Positive when quote a is better than quote b for the bettor (D1-D3).
export function cmpQuote(market, side, a, b) {
  const da = cellDecimal(a) || 0;
  const db = cellDecimal(b) || 0;
  if (market === 'spread' && a.line != null && b.line != null && a.line !== b.line) return a.line - b.line;
  if (market === 'total' && a.line != null && b.line != null && a.line !== b.line) {
    return side === 'over' ? b.line - a.line : a.line - b.line;
  }
  return da - db;
}

export function sidesFor(market, lg) {
  if (market === 'total') return ['over', 'under'];
  if (market === 'moneyline' && isThreeWay(lg)) return ['away', 'draw', 'home'];
  return ['away', 'home'];
}

// ---- ingest ---------------------------------------------------------------
function pickKey(g, m, s) {
  const p = g.best && g.best.raw && g.best.raw[m] && g.best.raw[m][s];
  return p ? [p.line, p.american, (p.books || []).join(',')].join('|') : '';
}

function diffGame(oldG, newG) {
  if (!oldG) return;
  const t = Date.now();
  for (const m of MARKETS) {
    const sides = Object.keys((newG.cells && newG.cells[m]) || {});
    for (const s of sides) {
      const nb = newG.cells[m][s] || {};
      const ob = (oldG.cells && oldG.cells[m] && oldG.cells[m][s]) || {};
      for (const book of Object.keys(nb)) {
        const o = ob[book];
        const n = nb[book];
        if (!o || !n) continue;
        if (o.line !== n.line || o.american !== n.american) {
          const dir = cmpQuote(m, s, n, o) >= 0 ? 1 : -1;
          S.flashes.set(newG.game_id + '|' + m + '|' + s + '|' + book, { dir, t });
        }
      }
      if (pickKey(oldG, m, s) !== pickKey(newG, m, s)) {
        S.flashes.set(newG.game_id + '|pick|' + m + '|' + s, { dir: 1, t });
      }
    }
  }
}

export function ingestBoard(lg, games) {
  abbrDirty = true;
  const m = new Map();
  for (const g of games || []) m.set(g.game_id, g);
  S.boards[lg] = m;
  S.boardLoaded[lg] = true;
}

export function ingestGames(list) {
  abbrDirty = true;
  for (const g of list || []) {
    S.gone.delete(g.game_id);
    const lg = g.league;
    const board = S.boards[lg] || (S.boards[lg] = new Map());
    const old = board.get(g.game_id);
    if (old && old.rev != null && g.rev != null && g.rev < old.rev) continue;
    diffGame(old, g);
    board.set(g.game_id, g);
    if (S.details[g.game_id]) S.details[g.game_id] = { ...S.details[g.game_id], ...g };
  }
}

// Games the server dropped (left the window or ESPN removed them). The open game keeps its last data and is marked gone.
export function ingestRemoved(ids) {
  if (!ids || !ids.length) return;
  abbrDirty = true;
  for (const id of ids) {
    for (const lg of Object.keys(S.boards)) S.boards[lg].delete(id);
    S.gone.add(id);
    if (id !== S.sel) delete S.details[id];
  }
}

export function ingestIndex(list) {
  abbrDirty = true;
  S.index = list || [];
}

export function ingestDetail(d) {
  if (!d || !d.game_id) return false;
  const old = S.details[d.game_id] || (S.boards[d.league] && S.boards[d.league].get(d.game_id));
  diffGame(old, d);
  S.details[d.game_id] = d;
  const board = S.boards[d.league] || (S.boards[d.league] = new Map());
  const prev = board.get(d.game_id);
  if (!prev || (prev.rev || 0) <= (d.rev || 0)) board.set(d.game_id, { ...(prev || {}), ...d });
  return true;
}

// Flash state for a key: { dir, age } while < 60 s, else null.
export function flashOf(key, cell) {
  const f = S.flashes.get(key);
  if (f) {
    const age = Date.now() - f.t;
    if (age < 60000) return { dir: f.dir, age };
    S.flashes.delete(key);
  }
  if (cell && cell.move && cell.moved_at) {
    const age = now() - Date.parse(cell.moved_at);
    if (age >= 0 && age < 60000) return { dir: cell.move, age: 60000 };
  }
  return null;
}

// ---- views -----------------------------------------------------------------
export function findGame(id) {
  if (S.details[id]) return S.details[id];
  for (const lg of Object.keys(S.boards)) {
    const g = S.boards[lg].get(id);
    if (g) return g;
  }
  return null;
}

// Same slate day (D15): the day rolls over at 5 a.m. Eastern, not midnight.
function sameDay(a, b) {
  return slateDay(a, b).diff === 0;
}

function inWindow(g, win) {
  if (win === 'all') return true;
  const t = now();
  const st = startMs(g);
  if (win === 'today') return sameDay(st, t);
  if (g.status === 'final' || g.status === 'postponed') return false;
  if (g.status === 'live') return true;
  if (win === 'soon') return st - t <= 2 * 3600e3;
  if (win === '24h') return st - t <= 24 * 3600e3;
  return true;
}

// League chip count for the active window, from the 72 h index (falls back to the server's 24 h count before the index loads).
export function leagueCount(l) {
  if (!S.index.length) return l.count_24h || 0;
  let n = 0;
  for (const g of S.index) if (g.league === l.id && inWindow(g, S.win)) n++;
  return n;
}

const ORDER = { live: 0, scheduled: 1, postponed: 2, final: 3 };

export function visibleGames() {
  const board = S.boards[S.league];
  if (!board) return [];
  const out = [];
  for (const g of board.values()) {
    if (!inWindow(g, S.win)) continue;
    if (S.query && !scoreGame(S.query, g)) continue;
    out.push(g);
  }
  out.sort((a, b) => (ORDER[a.status] ?? 1) - (ORDER[b.status] ?? 1) || startMs(a) - startMs(b));
  return out;
}

// Times are shown in Eastern, with "(late)" for a kickoff before the 5 a.m. rollover (D15).
export function timeLabel(g) {
  return fmtSlateTime(startMs(g));
}

// One day word for every label on the app clock: Today / Tomorrow / Yesterday / "Sat, Oct 10" (slate day).
function dayWord(st) {
  return slateDay(st, now()).label;
}

export function slotLabel(g) {
  if (g.status === 'live') return 'Live now';
  if (g.status === 'final') return 'Final';
  if (g.status === 'postponed') return 'Postponed';
  const st = startMs(g);
  return dayWord(st) + ' · ' + fmtSlateTime(st);
}

export function dayTimeLabel(g) {
  const st = startMs(g);
  return dayWord(st) + ' · ' + fmtSlateTime(st);
}

// Short local time like "7:59 AM", on the app clock (mock clock aware).
export function clockLabel(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const age = Math.max(0, Math.round((now() - t) / 1000));
  const when = (sameDay(t, now()) ? '' : dayWord(t) + ' ') + fmtEtClock(t);
  return { when, age };
}

// "Today 1:30 PM" style label for search rows, on the app clock.
export function dayShortLabel(g) {
  const st = startMs(g);
  const w = dayWord(st);
  return (w.includes(',') ? w.split(',')[0] : w) + ' ' + fmtSlateTime(st);
}

// American price on a straight scale where 0 is even money: -110 -> -10, +150 -> 50.
function cents(a) {
  return a > 0 ? a - 100 : a + 100;
}

// A price is real value when it beats the consensus line by 10 American cents at the same number,
// or the number itself is a full point better (D1: spread higher wins, over lower total, under higher total).
export function beatsConsensus(g, m, s, p) {
  if (!p || p.american == null) return false;
  const c = g.cells && g.cells[m] && g.cells[m][s] && g.cells[m][s].consensus;
  if (!c || c.american == null) return false;
  if (m === 'moneyline') return cents(p.american) - cents(c.american) >= 10;
  if (p.line == null || c.line == null) return false;
  const dl = m === 'total' && s === 'over' ? c.line - p.line : p.line - c.line;
  if (dl >= 1) return true;
  if (Math.abs(dl) < 1e-9) return cents(p.american) - cents(c.american) >= 10;
  return false;
}

// Best moneyline for the index shape, old or new: {home:{american,books}} or {raw:{...}} (quoted prices only, D13).
export function indexBestMl(game) {
  const b = game.best_ml;
  if (!b) return null;
  if (b.raw || b.fee) return b.raw || null;
  return b;
}
