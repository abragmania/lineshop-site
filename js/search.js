// Search box: fuzzy over the cross-league index. The dropdown is grouped by league (up to PER shown per league,
// "Show all N" expands a league); Enter with nothing highlighted opens a full results view on the board.
import { S, indexBestMl, startMs, findGame, dayShortLabel, abbrFor } from './state.js';
import { scoreGame } from './fuzzy.js';
import { fmtAmerican, fmtLine } from './format.js';
import { esc, teamPill, teamLogo, hl, priceHidden } from './ui.js';

const PER = 8;
let input;
let box;
let items = [];
let total = 0;
let sel = -1;
let hooks = {};
const expanded = new Set();

// All matching games, best match first, then by start time.
export function matches(q) {
  const scored = [];
  for (const g of S.index) {
    const sc = scoreGame(q, g);
    if (sc > 0) scored.push({ g, sc: sc + (g.league === S.league ? 2 : 0) });
  }
  scored.sort((a, b) => b.sc - a.sc || startMs(a.g) - startMs(b.g));
  return scored.map((x) => x.g);
}

// Matches grouped by league in the meta order, each group keeping its ranking.
function grouped(list) {
  const order = (S.meta ? S.meta.leagues : []).map((l) => l.id);
  const by = new Map();
  for (const g of list) {
    if (!by.has(g.league)) by.set(g.league, []);
    by.get(g.league).push(g);
  }
  const rank = (id) => (id === S.league ? -1 : order.indexOf(id));
  return [...by.entries()].sort((a, b) => rank(a[0]) - rank(b[0]));
}

function leagueOf(id) {
  return S.leagueById[id] || { id, label: id.toUpperCase(), accent: '#888' };
}

function leaguePill(id) {
  const l = leagueOf(id);
  return `<span class="lgp" style="--lg:${l.accent}">${esc(l.label)}</span>`;
}

// Best spread: the index may carry it; otherwise read it from the loaded board for that game.
function bestSpread(g, full) {
  const key = 'raw';
  let sp = g.best_spread && (g.best_spread[key] || g.best_spread);
  if (!sp || (!sp.home && !sp.away)) sp = full && full.best && full.best[key] && full.best[key].spread;
  if (!sp) return null;
  const h = sp.home;
  const a = sp.away;
  return h && h.line != null && (h.line < 0 || !a || a.line == null || h.line <= -a.line) ? ['home', h] : a && a.line != null ? ['away', a] : null;
}

function parts(g) {
  const full = findGame(g.game_id);
  const T = (side) => ({ ...g[side], ...((full && full[side]) || {}) });
  const away = T('away');
  const home = T('home');
  const lg = leagueOf(g.league);
  const bits = [];
  const ml = indexBestMl(g);
  if (ml && (ml.away || ml.home)) {
    bits.push(`<span class="sml"><i>ML</i> ${esc(abbrFor(away))} <b>${esc(fmtAmerican(ml.away && ml.away.american))}</b> · ${esc(abbrFor(home))} <b>${esc(fmtAmerican(ml.home && ml.home.american))}</b></span>`);
  }
  const sp = bestSpread(g, full);
  if (sp) {
    const [side, q] = sp;
    bits.push(`<span class="sml"><i>${S.leagueById[g.league] && S.leagueById[g.league].three_way ? 'HCP' : 'SPR'}</i> ${esc(abbrFor(side === 'home' ? home : away))} <b>${esc(fmtLine(q.line))}</b>${priceHidden('spread', q.books && q.books[0], q.american) ? '' : ' ' + esc(fmtAmerican(q.american))}</span>`);
  }
  return { away, home, lg, bits };
}

function item(g, i) {
  const { away, home, lg, bits } = parts(g);
  const q = input.value.trim();
  return `<div class="si${i === sel ? ' on' : ''}" data-i="${i}">${leaguePill(g.league)}<div class="sti">${teamLogo(away, 16)}${teamPill(away)}<span class="at">@</span>${teamLogo(home, 16)}${teamPill(home)}</div>
    <div class="smid"><div class="sn">${hl(away.name, q)} <span class="at">at</span> ${hl(home.name, q)}</div><div class="sline">${bits.join('') || '<span class="sml mu">No lines yet</span>'}</div></div>
    <span class="stime">${esc(dayShortLabel(g))}</span></div>`;
}

function compute() {
  const q = input.value.trim();
  items = [];
  total = 0;
  if (!q) return;
  const list = matches(q);
  total = list.length;
  for (const [lg, games] of grouped(list)) {
    const open = expanded.has(lg);
    const shown = open ? games : games.slice(0, PER);
    items.push({ type: 'head', lg, n: games.length });
    for (const g of shown) items.push({ type: 'g', g });
    if (games.length > shown.length) items.push({ type: 'more', lg, n: games.length });
  }
}

function draw() {
  if (!input.value.trim() || document.activeElement !== input) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  if (!total) {
    box.innerHTML = '<div class="sempty">No upcoming games match. The current view is filtered by this text too.</div>';
    return;
  }
  let html = '';
  items.forEach((it, i) => {
    if (it.type === 'head') {
      const l = leagueOf(it.lg);
      html += `<div class="sg" style="--lg:${l.accent}">${esc(l.label)} <small>${it.n} game${it.n === 1 ? '' : 's'}</small></div>`;
    } else if (it.type === 'more') {
      html += `<div class="si more${i === sel ? ' on' : ''}" data-i="${i}" style="--lg:${leagueOf(it.lg).accent}">Show all ${it.n} in ${esc(leagueOf(it.lg).label)}</div>`;
    } else html += item(it.g, i);
  });
  html += `<div class="sfoot">${total} match${total === 1 ? '' : 'es'}<span class="khint"> · <kbd>Enter</kbd> for the full results view · <kbd>↑</kbd><kbd>↓</kbd> to pick</span></div>`;
  box.innerHTML = html;
  const on = box.querySelector('.si.on');
  if (on) on.scrollIntoView({ block: 'nearest' });
}

export function refreshSearch() {
  if (!input) return;
  compute();
  sel = Math.min(sel, items.length - 1);
  draw();
}

function selectable(dir, from) {
  let i = from;
  for (;;) {
    i += dir;
    if (i < 0 || i >= items.length) return from;
    if (items[i].type !== 'head') return i;
  }
}

function choose(i) {
  const it = items[i];
  if (!it) return;
  if (it.type === 'more') {
    expanded.add(it.lg);
    compute();
    draw();
    return;
  }
  if (it.type !== 'g') return;
  input.value = '';
  S.query = '';
  S.fullSearch = false;
  box.hidden = true;
  input.blur();
  hooks.open(it.g);
}

function openFull() {
  if (!input.value.trim()) return;
  S.fullSearch = true;
  box.hidden = true;
  input.blur();
  hooks.filter();
}

export function initSearch(h) {
  hooks = h;
  input = document.getElementById('q');
  box = document.getElementById('sr');
  input.addEventListener('input', () => {
    S.query = input.value.trim();
    S.fullSearch = false;
    sel = -1;
    expanded.clear();
    compute();
    draw();
    hooks.filter();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      sel = selectable(1, sel);
      draw();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      sel = sel <= 0 ? -1 : selectable(-1, sel);
      draw();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (sel >= 0) choose(sel);
      else openFull();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      input.value = '';
      S.query = '';
      S.fullSearch = false;
      box.hidden = true;
      input.blur();
      hooks.filter();
    }
  });
  input.addEventListener('blur', () => setTimeout(() => (box.hidden = true), 150));
  input.addEventListener('focus', () => draw());
  box.addEventListener('mousedown', (e) => {
    const el = e.target.closest('.si');
    if (el) {
      e.preventDefault();
      choose(+el.dataset.i);
    }
  });
}

export function focusSearch() {
  input.focus();
  input.select();
}

// Full results view: every matching game, grouped by league, as cards.
export function renderResults(el) {
  const q = S.query;
  const list = matches(q);
  if (!list.length) {
    el.innerHTML = `<div class="empty-state">No games match “${esc(q)}”.<br><small>Press Esc to clear the search.</small></div>`;
    return;
  }
  el.innerHTML = `<div class="rhead">${list.length} game${list.length === 1 ? '' : 's'} match “${esc(q)}” <button class="chipb" data-act="clearq">Clear search</button></div>` +
    grouped(list)
      .map(([lg, games]) => {
        const l = leagueOf(lg);
        const cards = games
          .map((g) => {
            const { away, home, bits } = parts(g);
            const row = (t) => `<div class="rt">${teamLogo(t, 18)}${teamPill(t)}<span class="rn">${hl(t.name, q)}</span></div>`;
            return `<article class="rcard" data-g="${esc(g.game_id)}" style="--lg:${l.accent}"><div class="rtop">${leaguePill(g.league)}<span class="sp"></span><span class="stime">${esc(dayShortLabel(g))}</span></div>
              ${row(away)}${row(home)}<div class="sline">${bits.join('') || '<span class="sml mu">No lines yet</span>'}</div></article>`;
          })
          .join('');
        return `<section class="rgroup" style="--lg:${l.accent}"><h3><span class="lgp">${esc(l.label)}</span><small>${games.length} game${games.length === 1 ? '' : 's'}</small></h3><div class="rgrid">${cards}</div></section>`;
      })
      .join('');
}
