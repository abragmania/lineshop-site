// Static (public snapshot) mode: the same api.js calls served from files next to index.html.
// Active only when the page carries <meta name="lineshop-mode" content="static"> (inserted by the publisher).
// Relative URLs, no leading slash: GitHub Pages serves the site under /lineshop-site/. No SSE: a timer refetch instead.

export const STATIC = typeof document !== 'undefined' && !!document.querySelector('meta[name="lineshop-mode"][content="static"]');

// A snapshot older than this many minutes is "paused": everything amber, no green, banner says so.
export const PAUSE_AFTER_MIN = 20;
export const REFRESH_MS = 5 * 60 * 1000;
const SNAP_RECHECK_MS = 60 * 1000;

// builtAt in ms (null until source.json has loaded, or when it cannot be parsed), machine label.
export const snap = { builtAt: null, machine: '' };

// Server clock minus this device's clock, from the Date header of source.json; 0 when absent.
let skewMs = 0;

// "Now" on the server's clock: a phone with a wrong clock still ages quotes correctly.
export function nowMs() {
  return Date.now() + skewMs;
}

const listeners = [];
export function onSnapshot(fn) {
  listeners.push(fn);
}

// ---- pure helpers (tested) ---------------------------------------------------------
// A build time in the future (clock skew) counts as zero elapsed time.
export function elapsedSec(now, t0 = snap.builtAt) {
  return t0 == null ? 0 : Math.max(0, (now - t0) / 1000);
}

// Unknown build time cannot be verified, so it counts as paused.
export function isPaused(now) {
  return snap.builtAt == null || elapsedSec(now) > PAUSE_AFTER_MIN * 60;
}

export function ageWords(sec) {
  if (sec < 60) return 'just now';
  if (sec < 3600) return Math.floor(sec / 60) + ' min ago';
  if (sec < 48 * 3600) return Math.floor(sec / 3600) + ' h ago';
  return Math.floor(sec / 86400) + ' d ago';
}

export function bannerText(now) {
  if (snap.builtAt == null) return 'LineShop paused · update time unknown';
  const w = ageWords(elapsedSec(now));
  if (isPaused(now)) return 'LineShop paused · last update ' + w;
  return 'Updated ' + w + (snap.machine ? ' · ' + snap.machine : '');
}

// Each payload carries its own build time (_t0): the board's or game's generated_at, else the snapshot time when it was fetched.
export function stamp(obj, generatedAt) {
  const t = Date.parse(generatedAt);
  obj._t0 = Number.isFinite(t) ? t : snap.builtAt;
}

// Quote ages = published age + time since THIS payload was built. Paused (the snapshot or this payload is older than
// the limit): every quote stale, nothing best or near. The published flags are kept on the cell (_s0, _b0, _n0) so a
// newer payload or a late un-pause restores them.
export function adjustGame(g, now) {
  if (!g || !g.cells) return;
  const t0 = g._t0 != null ? g._t0 : snap.builtAt;
  const el = elapsedSec(now, t0);
  const paused = isPaused(now) || el > PAUSE_AFTER_MIN * 60;
  for (const m of Object.keys(g.cells)) {
    for (const s of Object.keys(g.cells[m] || {})) {
      const side = g.cells[m][s] || {};
      for (const id of Object.keys(side)) {
        const c = side[id];
        if (!c || typeof c !== 'object') continue;
        if (c._a0 === undefined) {
          c._a0 = c.age_s == null ? null : c.age_s;
          c._s0 = c.stale;
          c._b0 = c.best_raw;
          c._n0 = c.near_raw;
        }
        if (c._a0 != null) c.age_s = c._a0 + el;
        c.stale = paused ? true : c._s0;
        c.best_raw = paused ? false : c._b0;
        c.near_raw = paused ? false : c._n0;
      }
    }
  }
}

// state = the app's S: boards {league: Map(id -> game)} and details {id: game}.
export function adjustAll(state, now) {
  for (const lg of Object.keys(state.boards || {})) for (const g of state.boards[lg].values()) adjustGame(g, now);
  for (const id of Object.keys(state.details || {})) adjustGame(state.details[id], now);
}

// ---- transport ---------------------------------------------------------------------
async function loadSnapshot() {
  const r = await fetch('source.json?_=' + Date.now(), { cache: 'no-store', headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error('source.json ' + r.status);
  const d = await r.json();
  const t = Date.parse(d.builtAt);
  snap.builtAt = Number.isFinite(t) ? t : null;
  snap.machine = typeof d.machine === 'string' ? d.machine : '';
  const dh = r.headers && r.headers.get ? Date.parse(r.headers.get('date')) : NaN;
  if (Number.isFinite(dh)) skewMs = dh - Date.now();
  for (const fn of listeners) fn();
}

// One snapshot load at a time; a caller during a load shares it.
let inflight = null;
let lastLoad = 0;
function loadNow() {
  if (!inflight) {
    inflight = loadSnapshot()
      .catch(() => {})
      .finally(() => {
        inflight = null;
        lastLoad = Date.now();
      });
  }
  return inflight;
}

// Loads the snapshot info when it has never loaded or the last load is over a minute old, so a data fetch
// never uses an old build time (the data URLs carry it).
export function ensureSnapshot() {
  if (inflight) return inflight;
  if (Date.now() - lastLoad > SNAP_RECHECK_MS) return loadNow();
  return Promise.resolve();
}

async function j(path) {
  await ensureSnapshot();
  const r = await fetch(path + '?b=' + (snap.builtAt || 0), { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(path + ' ' + r.status);
  return r.json();
}

export const staticApi = {
  meta: () => j('data/meta.json'),
  index: () => j('data/index.json'),
  sources: () => j('data/sources.json'),
  // The client filters the time window itself, so every window reads the "all" file.
  async board(lg) {
    const b = await j('data/board/' + encodeURIComponent(lg) + '.json');
    for (const g of b.games || []) {
      stamp(g, b.generated_at);
      adjustGame(g, nowMs());
    }
    return b;
  },
  async game(id) {
    const d = await j('data/game/' + encodeURIComponent(id) + '.json');
    stamp(d, d.generated_at);
    adjustGame(d, nowMs());
    return d;
  },
  history: () => Promise.reject(new Error('Line history is on the local dashboard only')),
  // No stream: reload the snapshot info at once, then every REFRESH_MS while the page is visible and when it becomes
  // visible again, refetching the current league board, the open game, the index and the sources.
  stream(params, emit, status) {
    let stopped = false;
    let last = Date.now();
    status(true);
    const run = async () => {
      if (stopped) return;
      last = Date.now();
      try {
        await loadNow();
        const b = await staticApi.board(params.league);
        if (!stopped) emit('board', { league: params.league, games: b.games });
        if (params.game) {
          // A game that left the snapshot (404) keeps its last data, which ages amber by its own build time.
          const d = await staticApi.game(params.game).catch(() => null);
          if (d && !stopped) emit('detail', d);
        }
        const [idx, src] = await Promise.all([staticApi.index().catch(() => null), staticApi.sources().catch(() => null)]);
        if (!stopped && idx) emit('index', idx);
        if (!stopped && src) emit('sources', src);
        if (!stopped) status(true);
      } catch (e) {
        if (!stopped) status(false);
      }
    };
    loadNow();
    const timer = setInterval(() => {
      if (!document.hidden) run();
    }, REFRESH_MS);
    const onVis = () => {
      if (!document.hidden && Date.now() - last > SNAP_RECHECK_MS) run();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVis);
    };
  },
};
