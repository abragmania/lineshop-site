// Line-history panel (D12): one consensus line plus Kalshi's own price, for one game + market + side.
import { S, sidesFor, pickFor, abbrFor, now } from './state.js';
import { fmtAmerican, fmtLine, fmtTotalNum, americanToProb, hidesPrice } from './format.js';
import { esc, lineText } from './ui.js';
import { STATIC } from './staticapi.js';
import { RANGES, stepAt, inGap,keyMoves, stepPath, splitByGaps, runEnd, gapLabel, domainFor, timeTicks, fmtMoveTime, centsOf } from './histcore.js';

const KEY = 'lineshop.hist.v1';
const TTL_MS = 60000;
const CH = 236; // chart height in px
const H = { open: false, range: '3d', sides: {} };
const CACHE = new Map(); // key -> {data, at, loading, err}
let hooks = { api: null, render: () => {}, go: () => {} };
let LAST = null; // model of the chart on screen, for hover

const DEFAULT_SIDE = { spread: 'home', moneyline: 'home', total: 'over' };

export function initHistory(h) {
  hooks = { ...hooks, ...h };
  try {
    const o = JSON.parse(localStorage.getItem(KEY) || '{}');
    if (RANGES.some((r) => r[0] === o.range)) H.range = o.range;
  } catch (e) {
    /* storage unavailable */
  }
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseleave', hideTip);
}

function saveRange() {
  try {
    localStorage.setItem(KEY, JSON.stringify({ range: H.range }));
  } catch (e) {
    /* storage unavailable */
  }
}

// Render/demo hook: ?hist=24h|3d|all
export function histRange(r) {
  if (RANGES.some((x) => x[0] === r)) H.range = r;
}

// Point the panel at a market + side (called before the drawer opens or its tab changes).
export function openHistory(m, s) {
  H.open = true;
  if (s) H.sides[m] = s;
}

function sideFor(g, m) {
  const ok = sidesFor(m, g.league);
  return ok.includes(H.sides[m]) ? H.sides[m] : DEFAULT_SIDE[m];
}

// Delegated click handler. Returns true when the click belonged to the panel or a history trigger.
export function histClick(t) {
  let el;
  if ((el = t.closest('[data-hm]'))) {
    openHistory(el.dataset.hm, el.dataset.hs || H.sides[el.dataset.hm] || DEFAULT_SIDE[el.dataset.hm]);
    if (S.tab !== el.dataset.hm) {
      S.tab = el.dataset.hm;
      hooks.go(S.league, S.sel, S.tab);
    } else hooks.render();
    return true;
  }
  const dr = t.closest('#drawer');
  if (dr && (el = t.closest('tr[data-ctx]'))) {
    const [, m, s] = el.dataset.ctx.split('|');
    if (m && s) {
      openHistory(m, s);
      hooks.render();
      return true;
    }
  }
  if (!(el = t.closest('[data-h]'))) return false;
  const act = el.dataset.h;
  if (act === 'toggle') H.open = !H.open;
  else if (act === 'range') {
    H.range = el.dataset.v;
    saveRange();
  } else if (act === 'side') H.sides[S.tab] = el.dataset.v;
  else if (act === 'retry') CACHE.clear();
  hooks.render();
  return true;
}

// ---- data -------------------------------------------------------------------
function ensure(g, m, s, range) {
  const key = [g.game_id, m, s, range].join('|');
  let e = CACHE.get(key);
  if (!e) {
    e = { data: null, at: 0, loading: false, err: false };
    CACHE.set(key, e);
  }
  const stale = !e.data || Date.now() - e.at > (e.err ? 30000 : TTL_MS);
  if (stale && !e.loading && hooks.api) {
    e.loading = true;
    hooks.api
      .history(g.game_id, m, s, range)
      .catch((err) => (range === 'all' ? hooks.api.history(g.game_id, m, s, 'open') : Promise.reject(err)))
      .then((d) => {
        e.data = d;
        e.err = false;
      })
      .catch(() => {
        e.err = true;
      })
      .finally(() => {
        e.loading = false;
        e.at = Date.now();
        hooks.render();
      });
  }
  return e;
}

// ---- model --------------------------------------------------------------------
function pctOf(m, a) {
  const p = americanToProb(a);
  return p == null ? null : p * 100;
}

function leftVal(m, p) {
  return m === 'moneyline' ? pctOf(m, p[2]) : p[1];
}

export function buildModel(data, m, W) {
  const L = 50;
  const T = 16;
  const B = 24;
  const hasK = !!(data.kalshi && data.kalshi.length);
  const split = hasK && m !== 'moneyline';
  const R = split ? 46 : 16;
  const t0 = data.t0;
  const t1 = Math.max(data.now, t0 + 1);
  const cons = data.consensus.map((p, i) => ({ t: p[0], v: leftVal(m, p), line: p[1], a: p[2], src: (data.consensus_src || [])[i] || 'consensus' })).filter((p) => p.v != null);
  const kal = (data.kalshi || []).map((p) => {
    const pct = p[2] * 100;
    return { t: p[0], v: pct, line: p[1], a: p[3], pct };
  });
  const lv = cons.map((p) => p.v);
  if (!split) kal.forEach((p) => lv.push(p.v));
  const dl = domainFor(lv, m === 'moneyline' ? 6 : 2, 5);
  const dr = split ? domainFor(kal.map((p) => p.v), 8, 5) : null;
  const pw = W - L - R;
  const ph = CH - T - B;
  const X = (t) => L + ((t - t0) / (t1 - t0)) * pw;
  const Y = (v) => T + (1 - (v - dl.lo) / (dl.hi - dl.lo)) * ph;
  const Y2 = dr ? (v) => T + (1 - (v - dr.lo) / (dr.hi - dr.lo)) * ph : Y;
  return { m, W, L, T, B, R, pw, ph, t0, t1, X, Y, Y2, dl, dr, split, cons, kal, gaps: data.gaps || [], data };
}

function leftFmt(m) {
  return (v) => (m === 'moneyline' ? Math.round(v) + '%' : m === 'total' ? fmtTotalNum(v) : fmtLine(v));
}

// ---- chart ----------------------------------------------------------------------
function chartSvg(g, md) {
  const { m, W, L, T, R, pw, ph, t0, t1, X, Y, Y2, dl, dr, cons, kal, gaps } = md;
  const bottom = T + ph;
  const lf = leftFmt(m);
  let s = `<svg class="hc" viewBox="0 0 ${W} ${CH}" width="${W}" height="${CH}" role="img" aria-label="Line history chart">`;
  s += `<defs><pattern id="hch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" class="hc-hatch"/></pattern></defs>`;
  const idle = gaps.map((x) => [Math.max(t0, x[0]), Math.min(t1, x[1]), x[2]]).filter((x) => x[1] > x[0]);
  // grid + left axis
  for (const v of dl.ticks) {
    const y = Y(v).toFixed(1);
    s += `<line class="hc-grid" x1="${L}" x2="${W - R}" y1="${y}" y2="${y}"/><text class="hc-ay" x="${L - 7}" y="${(+y + 3.5).toFixed(1)}" text-anchor="end">${esc(lf(v))}</text>`;
  }
  if (dr) {
    for (const v of dr.ticks) s += `<text class="hc-ay k" x="${W - R + 7}" y="${(Y2(v) + 3.5).toFixed(1)}">${Math.round(v)}%</text>`;
  }
  // time axis
  for (const k of timeTicks(t0, t1, Math.max(3, Math.floor(pw / 110)))) {
    const x = X(k.t).toFixed(1);
    s += `<line class="hc-tick${k.major ? ' major' : ''}" x1="${x}" x2="${x}" y1="${T}" y2="${bottom}"/><text class="hc-ax${k.major ? ' major' : ''}" x="${x}" y="${CH - 7}" text-anchor="middle">${esc(k.label)}</text>`;
  }
  s += `<line class="hc-base" x1="${L}" x2="${W - R}" y1="${bottom}" y2="${bottom}"/>`;
  // idle bands
  for (const x of idle) s += `<rect class="hc-idle" x="${X(x[0]).toFixed(1)}" y="${T}" width="${Math.max(1, X(x[1]) - X(x[0])).toFixed(1)}" height="${ph}"><title>${esc(gapLabel(x))}</title></rect>`;
  // Kalshi
  if (kal.length) {
    for (const run of splitByGaps(kal, gaps)) {
      if (run.length < 2) continue;
      s += `<path class="hc-k" d="${run.map((p, i) => (i ? 'L' : 'M') + X(p.t).toFixed(1) + ' ' + Y2(p.v).toFixed(1)).join('')}"/>`;
    }
  }
  // consensus: the step line breaks at every gap (idle or no fresh consensus) and resumes after it
  if (cons.length) {
    for (const run of splitByGaps(cons, gaps)) {
      s += `<path class="hc-c" d="${stepPath(run, X, Y, runEnd(gaps, run[run.length - 1].t, t1))}"/>`;
    }
    // change markers + labels
    let lastX = -1e9;
    cons.forEach((p, i) => {
      const prev = cons[i - 1];
      const changed = !prev || (m === 'moneyline' ? Math.abs(centsOf(p.a) - centsOf(prev.a)) >= 10 : Math.abs((p.line || 0) - (prev.line || 0)) > 1e-9);
      if (!changed) return;
      const x = X(p.t);
      const y = Y(p.v);
      s += `<circle class="hc-pt" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3"/>`;
      const label = m === 'moneyline' ? fmtAmerican(p.a) : (lineText(m, 'over', p.line).replace(/^O /, '') + ' ' + (hidesPrice(m, 'book', p.a) ? '' : fmtAmerican(p.a))).trim();
      const w = label.length * 6.4;
      const lx = Math.max(L + 2, Math.min(W - R - w - 2, x + 5));
      if (lx < lastX + 6) return;
      lastX = lx + w;
      const above = y - 9 > T + 4;
      s += `<text class="hc-lab" x="${lx.toFixed(1)}" y="${(above ? y - 8 : y + 15).toFixed(1)}">${esc(label)}</text>`;
    });
    const last = cons[cons.length - 1];
    s += `<circle class="hc-now" cx="${X(t1).toFixed(1)}" cy="${Y(last.v).toFixed(1)}" r="4"/>`;
  }
  // hover layer
  s += `<line class="hc-x" id="hcx" x1="0" x2="0" y1="${T}" y2="${bottom}" hidden/><circle class="hc-hd c" id="hcdc" r="4" hidden/><circle class="hc-hd k" id="hcdk" r="4" hidden/>`;
  s += `<rect class="hc-hit" x="${L}" y="${T}" width="${pw}" height="${ph}"/></svg>`;
  return s;
}

// ---- panel ------------------------------------------------------------------------
function titleFor(g, m, s, data) {
  const last = data && data.consensus.length ? data.consensus[data.consensus.length - 1] : null;
  const pk = pickFor(g, m, s);
  const line = last ? last[1] : pk ? pk.line : null;
  const who = s === 'home' || s === 'away' ? g[s].short || g[s].name || abbrFor(g[s]) : s === 'draw' ? 'Draw' : s === 'over' ? 'Over' : 'Under';
  if (m === 'moneyline') return `${who} moneyline`;
  if (m === 'total') return `${who} ${line == null ? '' : fmtTotalNum(line)}`.trim();
  return `${who} ${line == null ? '' : fmtLine(line)}`.trim();
}

function movesHtml(md, data) {
  const ms = keyMoves(data, md.m);
  if (!ms.length) return '';
  const nowS = data.now;
  // The series is the consensus of sportsbooks; with no consensus it is Kalshi's own points (a prediction market, price always shown).
  const kind = data.consensus && data.consensus.length ? 'book' : 'prediction';
  const txt = (p) => (md.m === 'moneyline' ? fmtAmerican(p.american) : (lineText(md.m, md.side, p.line) + ' ' + (hidesPrice(md.m, kind, p.american) ? '' : fmtAmerican(p.american))).trim());
  const items = ms.map((p, i) => {
    const when = fmtMoveTime(p.t, nowS);
    const lab = p.first ? 'First seen ' : '';
    return `<span class="km${i === ms.length - 1 ? ' now' : ''}">${lab}<b>${esc(txt(p))}</b> <em>${esc(when)}</em></span>`;
  });
  const none = ms.length === 1 ? '<span class="km-none">No line change yet</span>' : '';
  return `<div class="hmoves"><span class="hk">Key moves</span>${items.join('<i>→</i>')}${none}</div>`;
}

function legendHtml(md, data) {
  const srcs = data.consensus_src || [];
  const pin = srcs.filter((x) => x === 'pin').length;
  let cname = 'Consensus';
  let note = '';
  if (pin && pin === srcs.length) {
    cname = 'Pinnacle';
    note = 'fallback: no consensus yet';
  } else if (pin) note = 'Pinnacle used for part of this range';
  let h = `<span class="hl"><i class="sw c"></i>${cname}${note ? `<small>${esc(note)}</small>` : ''}</span>`;
  if (md.kal.length) {
    const ref = data.kalshi_ref;
    h += `<span class="hl"><i class="sw k"></i>Kalshi ${md.m === 'moneyline' ? 'win %' : 'implied %'}<small>${ref && ref.line != null && md.m !== 'moneyline' ? 'contract line ' + esc(md.m === 'total' ? fmtTotalNum(ref.line) : fmtLine(ref.line)) : 'quoted'}</small></span>`;
  } else h += '<span class="hl dim">No Kalshi market for this game</span>';
  const seen = [...new Set(md.gaps.filter((x) => x[1] > md.t0 && x[0] < md.t1).map(gapLabel))];
  for (const lb of seen) h += `<span class="hl"><i class="sw idle"></i>${esc(lb)}</span>`;
  return h;
}

export function historyPanel(g, m, avail) {
  // Public snapshot: no history endpoint, one muted line instead of the panel.
  if (STATIC) return '<section class="hist static"><div class="hmsg">Line history is on the local dashboard only</div></section>';
  const s = sideFor(g, m);
  const sides = sidesFor(m, g.league);
  const sideName = (x) => (x === 'home' || x === 'away' ? abbrFor(g[x]) : x === 'draw' ? 'Draw' : x === 'over' ? 'Over' : 'Under');
  if (!H.open) {
    return `<section class="hist"><button class="hh" data-h="toggle" aria-expanded="false"><i class="chev"></i><span class="ht">Line history</span><span class="hs">${esc(titleFor(g, m, s, null))} — how the line moved</span></button></section>`;
  }
  const e = ensure(g, m, s, H.range);
  const data = e.data;
  const head = `<button class="hh" data-h="toggle" aria-expanded="true"><i class="chev dn"></i><span class="ht">${esc(titleFor(g, m, s, data))} — line history</span></button>
    <div class="hctl"><span class="seg sm">${sides.map((x) => `<button data-h="side" data-v="${x}" class="${x === s ? 'on' : ''}">${esc(sideName(x))}</button>`).join('')}</span>
    <span class="seg sm">${RANGES.map((r) => `<button data-h="range" data-v="${r[0]}" class="${r[0] === H.range ? 'on' : ''}">${r[1]}</button>`).join('')}</span></div>`;
  let body;
  if (!data) {
    body = e.err
      ? '<div class="hmsg">Could not load line history. <button class="lnk" data-h="retry">Retry</button></div>'
      : '<div class="hmsg">Loading history…</div>';
    LAST = null;
  } else if (!data.consensus || !data.consensus.length) {
    body = '<div class="hmsg">History starts when LineShop first sees this game.</div>';
    LAST = null;
  } else {
    const W = Math.max(300, Math.floor(avail) - 26);
    const md = buildModel(data, m, W);
    md.side = s;
    md.game = g;
    LAST = md;
    body = `${chartSvg(g, md)}<div class="hleg">${legendHtml(md, data)}</div>${movesHtml(md, data)}${data.source_note ? `<div class="hnote">${esc(data.source_note)}</div>` : ''}`;
  }
  return `<section class="hist open${e.loading && data ? ' busy' : ''}"><div class="hhead">${head}</div>${body}</section>`;
}

// ---- hover ----------------------------------------------------------------------------
let tipEl = null;
function tip() {
  if (!tipEl) {
    tipEl = document.createElement('div');
    tipEl.id = 'htip';
    tipEl.hidden = true;
    document.body.appendChild(tipEl);
  }
  return tipEl;
}

function hideTip() {
  if (tipEl) tipEl.hidden = true;
  for (const id of ['hcx', 'hcdc', 'hcdk']) {
    const n = document.getElementById(id);
    if (n) n.setAttribute('hidden', '');
  }
}

export function hoverHtml(md, t) {
  const m = md.m;
  const c = stepAt(md.cons.map((p) => [p.t, p]), t);
  const cp = c ? c[1] : null;
  const k = stepAt(md.kal.map((p) => [p.t, p]), t);
  const kp = k && t - k[0] <= 7200 ? k[1] : null;
  const gap = inGap(md.gaps, t);
  let h = `<div class="ht-t">${esc(fmtMoveTime(t, md.data.now))}</div>`;
  if (cp) {
    const v = m === 'moneyline' ? fmtAmerican(cp.a) + ' · ' + Math.round(cp.v * 10) / 10 + '%' : (lineText(m, md.side, cp.line) + ' ' + (hidesPrice(m, 'book', cp.a) ? '' : fmtAmerican(cp.a))).trim();
    h += `<div class="ht-r"><i class="sw c"></i><span>${cp.src === 'pin' ? 'Pinnacle' : 'Consensus'}</span><b>${esc(v)}</b></div>`;
  }
  if (md.kal.length) {
    const v = kp ? `${kp.pct.toFixed(1)}%${kp.a != null ? ' · ' + fmtAmerican(kp.a) : ''}` : '—';
    h += `<div class="ht-r"><i class="sw k"></i><span>Kalshi</span><b>${esc(v)}</b></div>`;
  }
  if (gap) h += `<div class="ht-g">${esc(gapLabel(gap))}</div>`;
  return h;
}

function onMove(e) {
  const hit = e.target.closest && e.target.closest('.hc-hit');
  if (!hit || !LAST) return hideTip();
  const md = LAST;
  const r = hit.getBoundingClientRect();
  const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  const t = md.t0 + f * (md.t1 - md.t0);
  const x = md.X(t);
  const cx = document.getElementById('hcx');
  cx.setAttribute('x1', x.toFixed(1));
  cx.setAttribute('x2', x.toFixed(1));
  cx.removeAttribute('hidden');
  const c = stepAt(md.cons.map((p) => [p.t, p]), t);
  const dc = document.getElementById('hcdc');
  if (c) {
    dc.setAttribute('cx', x.toFixed(1));
    dc.setAttribute('cy', md.Y(c[1].v).toFixed(1));
    dc.removeAttribute('hidden');
  } else dc.setAttribute('hidden', '');
  const k = stepAt(md.kal.map((p) => [p.t, p]), t);
  const dk = document.getElementById('hcdk');
  if (k && t - k[0] <= 7200) {
    dk.setAttribute('cx', x.toFixed(1));
    dk.setAttribute('cy', md.Y2(k[1].v).toFixed(1));
    dk.removeAttribute('hidden');
  } else dk.setAttribute('hidden', '');
  const el = tip();
  el.innerHTML = hoverHtml(md, t);
  el.hidden = false;
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  let left = e.clientX + 14;
  if (left + w > window.innerWidth - 8) left = e.clientX - w - 14;
  el.style.left = Math.max(8, left) + 'px';
  el.style.top = Math.max(8, Math.min(window.innerHeight - h - 8, e.clientY - h / 2)) + 'px';
}

void now;
