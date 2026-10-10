// ?mock=1: serves the golden files and simulates a few price changes so flashes are visible.
import { americanToDecimal, americanToProb, probToAmerican } from './format.js';

const BASE = '../tests/golden/';
const cache = {};
const boards = {};
let detailId = null;

async function get(name) {
  if (cache[name]) return cache[name];
  const r = await fetch(BASE + name + '.json');
  if (!r.ok) throw new Error(name + ' ' + r.status);
  cache[name] = await r.json();
  return cache[name];
}

async function loadBoard(lg) {
  if (boards[lg]) return boards[lg];
  let b;
  try {
    b = JSON.parse(JSON.stringify(await get('board_' + lg)));
  } catch (e) {
    b = { league: lg, generated_at: null, games: [] };
  }
  try {
    const d = JSON.parse(JSON.stringify(await get('game_detail')));
    detailId = d.game_id;
    if (d.league === lg) b.games = b.games.map((g) => (g.game_id === d.game_id ? d : g));
  } catch (e) {
    /* no detail file */
  }
  boards[lg] = b;
  return b;
}

function rankKey(m, s, c) {
  const dec = c.decimal;
  const line = c.line == null ? 0 : c.line;
  const primary = m === 'spread' ? line : m === 'total' ? (s === 'over' ? -line : line) : 0;
  return primary * 1000 + dec;
}

// Recompute best flags and the best pick for one side after a mock change.
function recompute(g, m, s) {
  const cells = g.cells[m][s];
  for (const mode of ['raw']) {
    let top = -Infinity;
    const elig = Object.values(cells).filter((c) => !c.stale && !c.alt && c.book !== 'consensus' && c.book !== 'open' && !/poly$/.test(c.book));
    for (const c of elig) top = Math.max(top, rankKey(m, s, c));
    const winners = [];
    for (const c of Object.values(cells)) {
      const isW = elig.includes(c) && Math.abs(rankKey(m, s, c) - top) < 1e-9;
      c.best_raw = isW;
      if (isW) winners.push(c);
    }
    const w = winners[0];
    if (w && g.best && g.best[mode]) {
      const prev = g.best[mode][m][s] || {};
      g.best[mode][m][s] = {
        ...prev, market: m, side: s, line: w.line,
        american: w.american,
        decimal: w.decimal, books: winners.map((x) => x.book),
      };
    }
  }
}

function nudge(g) {
  const ms = ['spread', 'moneyline', 'total'];
  const m = ms[Math.floor(Math.random() * 3)];
  const sides = Object.keys(g.cells[m]);
  const s = sides[Math.floor(Math.random() * sides.length)];
  const books = Object.keys(g.cells[m][s]).filter((b) => b !== 'open' && b !== 'consensus' && !g.cells[m][s][b].stale);
  if (!books.length) return false;
  const c = g.cells[m][s][books[Math.floor(Math.random() * books.length)]];
  if (c.american == null) return false;
  const step = [-10, -5, 5, 10][Math.floor(Math.random() * 4)];
  let a = c.american + step;
  if (a > -100 && a < 100) a = a >= 0 ? 100 : -100;
  c.american = a;
  c.decimal = americanToDecimal(a);
  c.implied = 1 / c.decimal;
  c.age_s = 0;
  c.move = step > 0 ? 1 : -1;
  c.moved_at = new Date(Date.now() + (window.__clockOffset || 0)).toISOString();
  recompute(g, m, s);
  g.rev = (g.rev || 0) + 1;
  return true;
}


// ---- synthetic line history (mirrors GET api/history/{game_id}) -------------------------------
const HR = 3600;
const RANGE_S = { '24h': 24 * HR, '3d': 72 * HR };

function baseCell(g, m, s) {
  const c = g.cells && g.cells[m] && g.cells[m][s] && (g.cells[m][s].consensus || null);
  if (c && c.american != null) return { line: c.line, american: c.american };
  const b = g.best && g.best.raw && g.best.raw[m] && g.best.raw[m][s];
  return b && b.american != null ? { line: b.line, american: b.american } : null;
}

// Golden games: ...82 has no Kalshi market and starts on Pinnacle; ...84 has no history yet.
function mockHistory(g, m, s, range) {
  const nowS = Math.floor((Date.now() + (window.__clockOffset || 0)) / 1000);
  const empty = { game_id: g.game_id, market: m, side: s, range, t0: nowS - (RANGE_S[range] || 5 * 24 * HR), now: nowS, consensus: [], consensus_src: [], kalshi: [], kalshi_ref: null, gaps: [], source_note: '' };
  const base = baseCell(g, m, s);
  if (!base || /-401872984$/.test(g.game_id)) return empty;
  const tOpen = nowS - Math.round(5.1 * 24 * HR);
  const t0 = range === 'all' ? tOpen : nowS - RANGE_S[range];
  const hasK = !/-401872982$/.test(g.game_id);
  const pBase = americanToProb(base.american);
  // [seconds before now, line offset from today's line, probability offset]
  const script = m === 'moneyline'
    ? [[5.1 * 24 * HR, 0, -0.05], [3.4 * 24 * HR, 0, -0.032], [1.6 * 24 * HR, 0, -0.012], [15 * HR, 0, 0.006], [5 * HR, 0, 0]]
    : [[5.1 * 24 * HR, -1, 0], [3.4 * 24 * HR, -0.5, 0], [15 * HR, 0, 0], [4 * HR, 0, 0]];
  const all = script.map(([dt, dl, dp], i) => {
    const t = nowS - Math.round(dt);
    if (m === 'moneyline') return [t, null, probToAmerican(Math.min(0.97, Math.max(0.03, pBase + dp)))];
    const a = i === script.length - 1 ? base.american : i === 0 ? -110 : -105;
    return [t, base.line + dl, a];
  });
  const idx0 = (() => { let k = 0; all.forEach((p, i) => { if (p[0] <= t0) k = i; }); return k; })();
  const cons = all.slice(idx0).map((p, i) => (i === 0 ? [Math.max(t0, p[0]), p[1], p[2]] : p));
  const src = cons.map((p) => (!hasK && p[0] < nowS - 60 * HR ? 'pin' : 'consensus'));
  const gaps = [[nowS - 40 * HR, nowS - Math.round(33.5 * HR), 'idle'], [nowS - 12 * HR, nowS - 9 * HR, 'no fresh consensus']].filter((x) => x[1] > t0);
  const kalshi = [];
  if (hasK) {
    const step = range === '24h' ? 1200 : 1800;
    for (let t = Math.max(t0, tOpen) + step; t <= nowS; t += step) {
      if (gaps.some((x) => t >= x[0] && t <= x[1])) continue;
      const k = (nowS - t) / HR;
      const drift = k > 82 ? -0.035 : k > 15 ? -0.012 : 0;
      const p = Math.min(0.96, Math.max(0.04, pBase + drift + 0.004 * Math.sin(t / 9000) + 0.0015 * Math.sin(t / 2300)));
      const lineNow = m === 'moneyline' ? null : base.line;
      kalshi.push([t, lineNow, Math.round(p * 1000) / 1000, probToAmerican(p), probToAmerican(Math.min(0.99, p + 0.012))]);
    }
  }
  return {
    game_id: g.game_id, market: m, side: s, range, t0, now: nowS,
    consensus: cons, consensus_src: src, kalshi,
    kalshi_ref: hasK ? { ticker: 'KX' + g.game_id.slice(-6), contract: m === 'moneyline' ? 'Winner' : m === 'total' ? 'Total points' : 'Spread', line: m === 'moneyline' ? null : base.line } : null,
    gaps,
    source_note: 'Consensus of the enabled books, recorded by LineShop while running; Kalshi from its own price history. Mock data.',
  };
}

export const mockApi = {
  async meta() {
    return get('meta');
  },
  async index() {
    const idx = await get('index');
    // ?synth=texas adds ~10 Texas-named NCAAF teams plus Houston Texans and Texas Rangers, to exercise search.
    if (new URLSearchParams(location.search).get('synth') !== 'texas') return idx;
    const T = (abbr, location, short, extra = {}) => ({ abbr, location, short, name: location + ' ' + short, aliases: [], ...extra });
    const teams = [
      T('TEX', 'Texas', 'Longhorns', { color: '#bf5700' }), T('TAMU', 'Texas A&M', 'Aggies', { color: '#500000' }),
      T('TTU', 'Texas Tech', 'Red Raiders', { color: '#cc0000' }), T('TXST', 'Texas State', 'Bobcats', { color: '#501214' }),
      T('UNT', 'North Texas', 'Mean Green', { color: '#00853e' }), T('UTSA', 'UTSA', 'Roadrunners', { color: '#0c2340', aliases: ['Texas San Antonio'] }),
      T('TXSO', 'Texas Southern', 'Tigers', { color: '#800000' }), T('UTEP', 'UTEP', 'Miners', { color: '#ff8200', aliases: ['Texas El Paso'] }),
      T('TCU', 'TCU', 'Horned Frogs', { color: '#4d1979', aliases: ['Texas Christian'] }), T('SFA', 'Stephen F. Austin', 'Lumberjacks', { color: '#4b2e83' }),
      T('OU', 'Oklahoma', 'Sooners', { color: '#841617' }), T('LSU', 'LSU', 'Tigers', { color: '#461d7c' }), T('UGA', 'Georgia', 'Bulldogs', { color: '#ba0c2f' }),
      T('ARK', 'Arkansas', 'Razorbacks', { color: '#9d2235' }), T('BAY', 'Baylor', 'Bears', { color: '#154734' }), T('RICE', 'Rice', 'Owls', { color: '#00205b' }),
      T('HOU', 'Houston', 'Cougars', { color: '#c8102e' }), T('SMU', 'SMU', 'Mustangs', { color: '#c8102e' }),
    ];
    const t0 = Date.parse(idx.generated_at);
    const mk = (i, lg, away, home, hrs) => ({
      game_id: lg + '-synth' + i, league: lg, start: new Date(t0 + hrs * 3600e3).toISOString(), status: 'scheduled', away, home,
      best_ml: { raw: { away: { american: 120 + i * 7, books: ['dk'] }, home: { american: -140 - i * 5, books: ['fd'] } } },
    });
    const [tex, tamu, ttu, txst, unt, utsa, txso, utep, tcu, sfa, ou, lsu, uga, ark, bay, rice, hou, smu] = teams;
    const g = [
      mk(1, 'ncaaf', ou, tex, 20), mk(2, 'ncaaf', tamu, lsu, 22), mk(3, 'ncaaf', ttu, bay, 24), mk(4, 'ncaaf', txst, rice, 26), mk(5, 'ncaaf', unt, smu, 27),
      mk(6, 'ncaaf', utsa, tcu, 28), mk(7, 'ncaaf', txso, sfa, 30), mk(8, 'ncaaf', utep, hou, 32), mk(9, 'ncaaf', uga, ark, 34), mk(10, 'ncaaf', tcu, tex, 40),
      mk(11, 'nfl', T('HOU', 'Houston', 'Texans'), T('IND', 'Indianapolis', 'Colts'), 50),
      mk(12, 'mlb', T('TEX', 'Texas', 'Rangers'), T('HOU', 'Houston', 'Astros'), 18),
    ];
    return { ...idx, games: [...idx.games, ...g] };
  },
  async sources() {
    return get('sources');
  },
  async board(lg) {
    return loadBoard(lg);
  },
  async game(id) {
    const lg = id.split('-')[0];
    const b = await loadBoard(lg);
    const g = b.games.find((x) => x.game_id === id);
    return g ? JSON.parse(JSON.stringify(g)) : null;
  },
  async history(id, m, s, range) {
    const g = await mockApi.game(id);
    if (!g) throw new Error('no game');
    return mockHistory(g, m, s, range);
  },
  stream(params, emit, status) {
    let alive = true;
    let timer = null;
    (async () => {
      const b = await loadBoard(params.league);
      if (!alive) return;
      status(true);
      emit('board', JSON.parse(JSON.stringify(b)));
      timer = setInterval(() => {
        const cand = b.games.filter((g) => g.status === 'scheduled' && g.cells && Object.keys(g.cells.spread.home).length);
        if (!cand.length) return;
        const n = 1 + Math.floor(Math.random() * 3);
        const changed = new Set();
        for (let i = 0; i < n; i++) {
          const g = cand[Math.floor(Math.random() * cand.length)];
          if (nudge(g)) changed.add(g);
        }
        if (changed.size) emit('games', { league: params.league, games: JSON.parse(JSON.stringify([...changed])) });
        if (params.game) {
          const d = b.games.find((x) => x.game_id === params.game);
          if (d && changed.has(d)) emit('detail', JSON.parse(JSON.stringify(d)));
        }
      }, 3500);
    })();
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
    };
  },
};

export { detailId };
