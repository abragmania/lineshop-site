// LineShop frontend: state wiring, routing, live stream, keyboard.
import { S, loadSettings, saveSettings, setMeta, ingestBoard, ingestGames, ingestDetail, ingestIndex, ingestRemoved, visibleGames, findGame, now, leagueAccent, bookInfo, MARKETS, cmpQuote, mktLabel, leagueCount } from './state.js';
import { createApi } from './api.js';
import { STATIC, nowMs, bannerText, isPaused, adjustAll, onSnapshot, ensureSnapshot } from './staticapi.js';
import { renderBoard, markJump } from './board.js';
import { renderGrid, gridBooks } from './grid.js';
import { renderDrawer } from './drawer.js';
import { initHistory, histClick, openHistory, histRange } from './history.js';
import { initSearch, focusSearch, refreshSearch, renderResults } from './search.js';
import { fmtAge, fmtCountdown, fmtLine, fmtTotalNum } from './format.js';
import { esc, bookChip, collectLogos, reuseLogos, priceText, priceHidden, OFF_TIP } from './ui.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
S.mock = params.get('mock') === '1';
const api = createApi(S.mock);

let closeStream = null;
let streamKey = '';
let rafId = 0;

// ---- theme / settings -------------------------------------------------------
function applyTheme() {
  document.documentElement.setAttribute('data-theme', S.theme);
  $('theme').innerHTML = S.theme === 'dark' ? '☾' : '☀';
  $('theme').title = S.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
}

function setSetting(k, v) {
  S[k] = v;
  saveSettings();
  if (k === 'theme') applyTheme();
  render();
}

// ---- rendering --------------------------------------------------------------
export function render() {
  if (rafId) return;
  rafId = requestAnimationFrame(() => {
    rafId = 0;
    doRender();
  });
}

function setSeg(id, attr, val) {
  for (const b of $(id).children) b.classList.toggle('on', b.dataset[attr] === val);
}

// Under 600 px there is no Grid view: the board is the only layout.
function curView() {
  return window.matchMedia && window.matchMedia('(max-width: 600px)').matches ? 'board' : S.view;
}

// Height of what stays pinned at the top. On a phone the header box is dissolved (display: contents) and only
// the snapshot bar and the league row stay pinned.
function topHeight() {
  const t = $('top');
  if (getComputedStyle(t).display !== 'contents') return t.offsetHeight;
  const bar = $('snapbar');
  return (bar.hidden ? 0 : bar.offsetHeight) + t.querySelector('.row2').offsetHeight;
}

// ---- failed refreshes: never silent. Log, and mark the board / drawer as showing old data until the next success.
const lastOk = { Board: Date.now(), Game: Date.now() };
const hhmm = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
function refreshFailed(kind, what, e) {
  console.warn('LineShop: ' + what + ' refresh failed', e);
  if (!S['fail' + kind]) S['fail' + kind] = lastOk[kind];
  render();
}
function refreshOk(kind) {
  lastOk[kind] = Date.now();
  S['fail' + kind] = 0;
}
function loadGame(id) {
  return api.game(id).then((d) => {
    if (d && ingestDetail(d)) {
      refreshOk('Game');
      render();
    }
  }).catch((e) => refreshFailed('Game', 'game ' + id, e));
}
function staleNote(kind) {
  return `Couldn't refresh — showing data from ${hhmm(S['fail' + kind])}`;
}

function renderSnap() {
  const bar = $('snapbar');
  const t = nowMs();
  bar.hidden = false;
  bar.textContent = bannerText(t);
  bar.className = isPaused(t) ? 'paused' : '';
  document.body.classList.toggle('snap-paused', isPaused(t));
}

function renderTop() {
  const view = curView();
  if (STATIC) renderSnap();
  setSeg('win', 'win', S.win);
  setSeg('viewseg', 'view', view);
  setSeg('disp', 'disp', S.display);
  setSeg('mkt', 'mkt', S.market);
  $('mkt').hidden = view !== 'grid';
  $('mkt').children[0].textContent = mktLabel('spread', S.league);
  $('booksbtn').hidden = view !== 'grid';
  const leagues = S.meta ? S.meta.leagues : [];
  $('leagues').innerHTML = leagues
    .map((l, i) => {
      const n = leagueCount(l);
      return `<button class="lgchip${l.id === S.league ? ' on' : ''}${n ? '' : ' none'}" data-lg="${l.id}" style="--lg:${l.accent}" title="${esc(l.label)} (${i + 1})">${esc(l.label)}<span>${n}</span></button>`;
    })
    .join('');
  const dots = S.sources
    .map((s) => `<i class="sdot s-${esc(s.state)}" data-src="${esc(s.source)}"></i>`)
    .join('');
  $('dots').innerHTML = dots;
  const connMsg = S.conn === 'down' || S.conn === 'refreshing';
  $('banner').hidden = !connMsg && !S.failBoard;
  $('banner').className = S.conn === 'refreshing' ? 'soft' : '';
  $('banner').textContent = connMsg
    ? (S.conn === 'refreshing' ? 'Refreshing prices…' : 'Reconnecting… showing the last data received.')
    : staleNote('Board');
  document.documentElement.style.setProperty('--topH', topHeight() + 'px');
}

function doRender() {
  // Public snapshot: quote ages and the paused look follow the clock, not just the data.
  if (STATIC) adjustAll(S, nowMs());
  renderTop();
  const main = $('main');
  const gw = main.querySelector('.gwrap');
  const sx = gw ? gw.scrollLeft : 0;
  const sy = gw ? gw.scrollTop : 0;
  const view = curView();
  main.className = 'main v-' + view;
  const logos = collectLogos(main, $('drawer'));
  if (S.fullSearch && S.query) renderResults(main);
  else if (view === 'board') renderBoard(main);
  else renderGrid(main);
  const gw2 = main.querySelector('.gwrap');
  if (gw2) {
    gw2.scrollLeft = sx;
    gw2.scrollTop = sy;
  }
  const open = !!S.sel;
  $('drawer').hidden = !open;
  $('scrim').hidden = !open;
  document.body.classList.toggle('dopen', open);
  if (open) {
    renderDrawer($('drawer'));
    const db = $('drawer').querySelector('.db');
    if (S.failGame && db) db.insertAdjacentHTML('afterbegin', `<div class="gone stalenote">${esc(staleNote('Game'))}</div>`);
  }
  reuseLogos(logos, main, $('drawer'));
  refreshSearch();
}

// ---- routing -----------------------------------------------------------------
function parseHash() {
  const m = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const out = { league: null, game: null, tab: null };
  if (m[0] && (!S.meta || S.leagueById[m[0]])) out.league = m[0];
  if (m[1] === 'game' && m[2]) {
    out.game = decodeURIComponent(m[2]);
    if (MARKETS.includes(m[3])) out.tab = m[3];
  }
  return out;
}

function hashFor(lg, game, tab) {
  return '#/' + lg + (game ? '/game/' + encodeURIComponent(game) + (tab && tab !== 'spread' ? '/' + tab : '') : '');
}

function go(lg, game, tab) {
  const h = hashFor(lg, game, tab);
  if (location.hash === h) onRoute();
  else location.hash = h;
}

function onRoute() {
  const r = parseHash();
  let changed = false;
  if (r.league && r.league !== S.league) {
    S.league = r.league;
    S.cursor = -1;
    changed = true;
  }
  if (r.game !== S.sel) {
    S.sel = r.game;
    changed = true;
    if (r.game) {
      const lg = r.game.split('-')[0];
      if (S.leagueById[lg] && lg !== S.league) S.league = lg;
      S.failGame = 0;
      loadGame(r.game);
    }
  }
  if (r.tab) S.tab = r.tab;
  else if (r.game) S.tab = 'spread';
  if (changed) {
    saveSettings();
    restartStream();
  }
  render();
}

function openGame(g, tab) {
  if (tab) S.tab = tab;
  go(g.league, g.game_id, S.tab);
}

function closeDrawer() {
  if (!S.sel) return;
  go(S.league, null);
}

// ---- live stream --------------------------------------------------------------
function emit(type, d) {
  if (type === 'board') {
    ingestBoard(d.league || S.league, d.games);
    refreshOk('Board');
  }
  else if (type === 'games') {
    ingestGames(d.games || d);
    ingestRemoved(d.removed);
    refreshOk('Board');
  }
  else if (type === 'detail') {
    ingestDetail(d);
    refreshOk('Game');
  }
  else if (type === 'index') ingestIndex(d.games || d);
  else if (type === 'sources') S.sources = d.sources || d;
  render();
}

function restartStream(forceBoard) {
  const key = S.league + '|' + (S.sel || '') + '|' + (S.win === 'all' ? 'all' : '24h');
  if (key === streamKey) return;
  streamKey = key;
  if (closeStream) closeStream();
  closeStream = api.stream(
    { league: S.league, game: S.sel, win: S.win },
    emit,
    (ok) => {
      if (S.conn === 'refreshing' && ok) return;
      const next = ok ? 'ok' : 'down';
      if (next !== S.conn) {
        S.conn = next;
        render();
      }
    },
  );
  // First paint does not wait for the stream.
  const lg = S.league;
  api.board(lg, S.win).then((b) => {
    refreshOk('Board');
    if (!S.boardLoaded[lg] || forceBoard) {
      ingestBoard(lg, b.games);
      render();
    }
  }).catch((e) => {
    if (!S.boardLoaded[lg]) ingestBoard(lg, []);
    refreshFailed('Board', 'board ' + lg, e);
  });
}

// ---- idle when hidden (D11): close the stream after 5 minutes in a background tab, refetch on return ----
let hideTimer = 0;
function onVisibility() {
  if (document.hidden) {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (closeStream) closeStream();
      closeStream = null;
      streamKey = '';
      S.conn = 'idle';
      render();
    }, 5 * 60 * 1000);
    return;
  }
  clearTimeout(hideTimer);
  if (S.conn !== 'idle') return;
  S.conn = 'refreshing';
  const lg = S.league;
  restartStream();
  const done = () => {
    if (S.conn === 'refreshing') S.conn = 'ok';
    render();
  };
  if (S.sel) loadGame(S.sel);
  api.board(lg, S.win).then((b) => { ingestBoard(lg, b.games); refreshOk('Board'); done(); }).catch((e) => { refreshFailed('Board', 'board ' + lg, e); done(); });
  render();
}

// ---- popovers ------------------------------------------------------------------
function showPop(html, anchor, cls) {
  const pop = $('pop');
  pop.className = cls || '';
  pop.innerHTML = html;
  pop.hidden = false;
  const r = anchor.getBoundingClientRect();
  const w = pop.offsetWidth;
  pop.style.top = r.bottom + 6 + 'px';
  pop.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w)) + 'px';
  pop.dataset.for = anchor.id;
}

function hidePop() {
  $('pop').hidden = true;
  $('pop').dataset.for = '';
}

function ago(iso) {
  if (!iso) return '—';
  return fmtAge((now() - Date.parse(iso)) / 1000) + ' ago';
}

function sourcesPop(anchor) {
  // The public snapshot carries only source, label, state, last_ok and league counts: no host, interval or failures.
  const rows = S.sources
    .map((s) => {
      const lg = Object.entries(s.leagues || {})
        .map(([k, v]) => `${k.toUpperCase()} ${v.matched}/${v.events}`)
        .join(' · ');
      const more = STATIC ? '' : `<td class="n">${s.interval_s ? s.interval_s + ' s' : '—'}</td><td class="n">${s.consecutive_failures || 0}</td>`;
      return `<tr><td><i class="sdot s-${esc(s.state)}"></i></td><td class="l"><b>${esc(s.label)}</b>${STATIC ? '' : `<small>${esc(s.host)}</small>`}</td><td>${esc(s.state)}</td><td class="n">${esc(ago(s.last_ok))}</td>${more}<td class="l mu">${esc(lg || s.message || '')}${s.quota_remaining != null ? ' · quota ' + s.quota_remaining : ''}</td></tr>`;
    })
    .join('');
  const more = STATIC ? '' : '<th class="n">Every</th><th class="n">Fails</th>';
  showPop(
    `<h4>Sources <small>matched / events per league</small></h4><table class="stbl"><thead><tr><th></th><th class="l">Source</th><th class="l">State</th><th class="n">Last ok</th>${more}<th class="l">Leagues</th></tr></thead><tbody>${rows}</tbody></table>`,
    anchor,
    'pop-src',
  );
}

function booksPop(anchor) {
  const items = S.books
    .map((b) => {
      const dis = !b.enabled;
      return `<label class="bi${dis ? ' dis' : ''}"><input type="checkbox" data-book="${b.id}" ${dis ? 'disabled' : ''} ${!S.hiddenBooks.has(b.id) && !dis ? 'checked' : ''}>${bookChip(b.id)}<span>${esc(b.label)}</span>${dis ? `<em>${esc(b.note || 'no public feed')}</em>` : b.indicative ? '<em>indicative</em>' : ''}</label>`;
    })
    .join('');
  showPop(`<h4>Book columns <button class="lnk" data-act="allbooks">show all</button></h4><div class="bl">${items}</div>`, anchor, 'pop-books');
}

const tip = document.createElement('div');
tip.id = 'tip';
tip.hidden = true;
document.body.appendChild(tip);

function srcTip(s) {
  const lg = Object.entries(s.leagues || {})
    .map(([k, v]) => `${k.toUpperCase()} ${v.matched}/${v.events}`)
    .join(' · ');
  return `<b>${esc(s.label)}</b> <span class="sdot s-${esc(s.state)}"></span> ${esc(s.state)}<br>last ok ${esc(ago(s.last_ok))} · every ${s.interval_s || '?'} s${s.consecutive_failures ? ' · ' + s.consecutive_failures + ' failures' : ''}${lg ? '<br>' + esc(lg) : ''}${s.message ? '<br>' + esc(s.message) : ''}`;
}

const HELP = [
  ['/', 'Search'], ['1 – 8', 'Switch league (tabs 1–3 when a game is open)'], ['g', 'Board / Grid'], ['s m t a', 'Spread / ML / Total / All'],
['j k', 'Move through games'], ['Enter', 'Open game'], ['[ ]', 'Previous / next game'], ['Esc', 'Close'], ['?', 'This help'],
];

function toggleHelp(force) {
  const h = $('help');
  const show = force != null ? force : h.hidden;
  h.hidden = !show;
  if (show) {
    h.innerHTML = `<div class="hbox"><h4>Keyboard</h4>${HELP.map(([k, d]) => `<div><kbd>${k}</kbd><span>${d}</span></div>`).join('')}<button class="chipb" data-act="helpx">Close</button></div>`;
  }
}

// ---- events ------------------------------------------------------------------------
function moveCursor(d) {
  const list = visibleGames();
  if (!list.length) return;
  if (S.sel) {
    const i = list.findIndex((g) => g.game_id === S.sel);
    const n = list[Math.max(0, Math.min(list.length - 1, (i < 0 ? 0 : i) + d))];
    go(n.league, n.game_id, S.tab);
    return;
  }
  S.cursor = Math.max(0, Math.min(list.length - 1, S.cursor + d));
  render();
  requestAnimationFrame(() => {
    const el = document.querySelector('.card.cur') || document.querySelector(`tr.gr[data-g="${list[S.cursor].game_id}"]`);
    if (el) el.scrollIntoView({ block: 'nearest' });
  });
}

function onKey(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const tag = (e.target.tagName || '').toLowerCase();
  const typing = tag === 'input' || tag === 'textarea' || tag === 'select';
  if (typing) return;
  const k = e.key;
  if (k === 'Escape') {
    if (S.fullSearch) {
      S.fullSearch = false;
      S.query = '';
      $('q').value = '';
      render();
    } else if (!$('help').hidden) toggleHelp(false);
    else if (!$('pop').hidden) hidePop();
    else closeDrawer();
    return;
  }
  if (k === '/') {
    e.preventDefault();
    focusSearch();
  } else if (k === '?') toggleHelp();
  else if (k === 'g') setSetting('view', S.view === 'board' ? 'grid' : 'board');
  else if (k === 'j') moveCursor(1);
  else if (k === 'k') moveCursor(-1);
  else if (k === ']') moveCursor(1);
  else if (k === '[') moveCursor(-1);
  else if (k === 'Enter') {
    const list = visibleGames();
    if (!S.sel && S.cursor >= 0 && list[S.cursor]) openGame(list[S.cursor]);
  } else if (/^[1-8]$/.test(k)) {
    const i = +k - 1;
    if (S.sel && i < 3) {
      S.tab = MARKETS[i];
      go(S.league, S.sel, S.tab);
    } else if (S.meta && S.meta.leagues[i]) go(S.meta.leagues[i].id, null);
  } else if ('smta'.includes(k) && k.length === 1) {
    const m = { s: 'spread', m: 'moneyline', t: 'total', a: 'all' }[k];
    if (S.sel && m !== 'all') {
      S.tab = m;
      go(S.league, S.sel, S.tab);
    } else setSetting('market', m);
  }
}

function onClick(e) {
  const t = e.target;
  let el;
  if (t.closest('[data-act="clearq"]')) {
    S.fullSearch = false;
    S.query = '';
    $('q').value = '';
    return render();
  }
  // D20: a book link (chip or cell arrow) opens its page in a new tab and never also opens the drawer.
  if (t.closest('a.bk-link, a.cl')) return;
  if ((e.ctrlKey || e.metaKey) && (el = t.closest('td[data-link]'))) {
    window.open(el.dataset.link, '_blank', 'noopener,noreferrer');
    e.preventDefault();
    return;
  }
  if ((el = t.closest('[data-jump]'))) {
    const target = document.getElementById(el.dataset.jump);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  if ((el = t.closest('[data-win]'))) {
    const was = S.win === 'all';
    setSetting('win', el.dataset.win);
    // Only the All chip changes what the server sends; restart the stream and refetch the board when that flips.
    if (was !== (S.win === 'all')) {
      for (const lg of Object.keys(S.boardLoaded)) if (lg !== S.league) delete S.boardLoaded[lg];
      restartStream(true);
    }
    return;
  }
  if ((el = t.closest('[data-view]'))) return setSetting('view', el.dataset.view);
  if ((el = t.closest('[data-disp]'))) return setSetting('display', el.dataset.disp);
  if ((el = t.closest('[data-mkt]'))) return setSetting('market', el.dataset.mkt);
  if (t.closest('#theme')) return setSetting('theme', S.theme === 'dark' ? 'light' : 'dark');
  if (t.closest('#helpbtn')) return toggleHelp();
  if ((el = t.closest('[data-lg]'))) return go(el.dataset.lg, null);
  if ((el = t.closest('#srcbtn'))) {
    if (!$('pop').hidden && $('pop').dataset.for === 'srcbtn') return hidePop();
    return sourcesPop(el);
  }
  if ((el = t.closest('#booksbtn'))) {
    if (!$('pop').hidden && $('pop').dataset.for === 'booksbtn') return hidePop();
    return booksPop(el);
  }
  if (t.closest('[data-act="helpx"]') || t.id === 'help') return toggleHelp(false);
  if ((el = t.closest('[data-act="allbooks"]'))) {
    S.hiddenBooks.clear();
    saveSettings();
    booksPop($('booksbtn'));
    return render();
  }
  if (!t.closest('#pop')) hidePop();
  if ((el = t.closest('[data-sort]'))) {
    const k = el.dataset.sort;
    if (S.sort.key === k) S.sort.dir = -S.sort.dir;
    else S.sort = { key: k, dir: 1 };
    return render();
  }
  if (t.closest('#scrim') || t.closest('[data-act="close"]')) return closeDrawer();
  if ((el = t.closest('[data-act="prev"]'))) return moveCursor(-1);
  if ((el = t.closest('[data-act="next"]'))) return moveCursor(1);
  if (histClick(t)) return;
  if ((el = t.closest('[data-act="tab"]'))) {
    S.tab = el.dataset.tab;
    return go(S.league, S.sel, S.tab);
  }
  if (t.closest('#drawer')) return;
  if ((el = t.closest('[data-g]'))) {
    const g = findGame(el.dataset.g) || S.index.find((x) => x.game_id === el.dataset.g);
    if (g) {
      if (el.classList.contains('bc') && el.dataset.s && !el.classList.contains('empty')) openHistory(el.dataset.m, el.dataset.s);
      const list = visibleGames();
      S.cursor = list.findIndex((x) => x.game_id === g.game_id);
      openGame(g, el.dataset.m || (S.view === 'grid' && S.market !== 'all' ? S.market : S.tab));
    }
  }
}

function onChange(e) {
  const cb = e.target.closest('[data-book]');
  if (!cb) return;
  if (cb.checked) S.hiddenBooks.delete(cb.dataset.book);
  else S.hiddenBooks.add(cb.dataset.book);
  saveSettings();
  render();
}

// ---- book chip hover card: full name, quote age, next-best book and price ---------------
const chipTip = document.createElement('div');
chipTip.id = 'chiptip';
chipTip.hidden = true;
document.body.appendChild(chipTip);

function quoteTxt(m, c, id) {
  const hide = priceHidden(m, id, c.american);
  const p = hide ? '' : priceText(c.american);
  if (m === 'moneyline' || c.line == null) return p;
  return ((m === 'total' ? fmtTotalNum(c.line) : fmtLine(c.line)) + ' ' + p).trim();
}

function chipCard(chip) {
  const id = chip.dataset.bk;
  const b = bookInfo(id);
  const kind = b.kind === 'prediction' ? 'Prediction market' : b.kind === 'reference' ? 'Reference line' : 'Sportsbook';
  let html = `<div class="ct-h"><b>${esc(b.label)}</b><span>${kind}${b.indicative ? ' · indicative' : ''}</span></div>`;
  const host = chip.closest('[data-ctx]');
  const [gid, m, side] = host ? host.dataset.ctx.split('|') : [];
  const g = gid ? findGame(gid) : null;
  const cells = g && g.cells && g.cells[m] && g.cells[m][side];
  if (cells && cells[id]) {
    const c = cells[id];
    html += `<div class="ct-r"><span>Quote</span><b>${esc(quoteTxt(m, c, id))}</b></div>`;
    if (c.off_market) html += `<div class="ct-n off">⚠ ${esc(OFF_TIP)}</div>`;
    html += `<div class="ct-r"><span>Age</span><b class="${c.stale ? 'amber' : ''}">${c.stale ? 'stale ' : ''}${esc(fmtAge(c.age_s))}</b></div>`;
    const others = Object.keys(cells)
      .filter((k) => k !== id && bookInfo(k).kind !== 'reference' && !cells[k].stale && !cells[k].alt && !cells[k].off_market && cells[k].american != null)
      .sort((x, y) => cmpQuote(m, side, cells[y], cells[x]));
    const mine = cmpQuote(m, side, c, cells[others[0]] || c);
    if (others.length) {
      const o = others[0];
      html += `<div class="ct-r"><span>${mine >= 0 ? 'Next best' : 'Best'}</span><b>${bookChip(o)} ${esc(quoteTxt(m, cells[o], o))}</b></div>`;
    }
  } else if (b.note) html += `<div class="ct-n">${esc(b.note)}</div>`;
  return html;
}

function wireChips() {
  document.addEventListener('mouseover', (e) => {
    const chip = e.target.closest && e.target.closest('.bk[data-bk]');
    if (!chip) return;
    chipTip.innerHTML = chipCard(chip);
    chipTip.hidden = false;
    const r = chip.getBoundingClientRect();
    const w = chipTip.offsetWidth;
    const h = chipTip.offsetHeight;
    let top = r.bottom + 6;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
    chipTip.style.top = top + 'px';
    chipTip.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left - 8)) + 'px';
  });
  document.addEventListener('mouseout', (e) => {
    if (e.target.closest && e.target.closest('.bk[data-bk]')) chipTip.hidden = true;
  });
  // A logo that fails to load is hidden, never shown broken.
  document.addEventListener('error', (e) => {
    if (e.target && e.target.classList && e.target.classList.contains('tl')) e.target.style.display = 'none';
  }, true);
  window.addEventListener('scroll', () => { chipTip.hidden = true; markJump(); }, { passive: true });
  let rt = 0;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(render, 120); });
}

// ---- boot -------------------------------------------------------------------------------
async function boot() {
  loadSettings();
  // Optional overrides for links and renders: ?view=grid&market=all&theme=light&win=all&display=pct
  for (const k of ['view', 'market', 'theme', 'win', 'display']) if (params.get(k)) S[k] = params.get(k);
  applyTheme();
  document.addEventListener('keydown', onKey);
  document.addEventListener('click', onClick);
  document.addEventListener('change', onChange);
  window.addEventListener('hashchange', onRoute);
  wireChips();
  document.addEventListener('visibilitychange', onVisibility);
  initHistory({ api, render, go });
  document.addEventListener('mouseover', (e) => {
    const d = e.target.closest && e.target.closest('.sdot[data-src]');
    if (!d) return;
    const s = S.sources.find((x) => x.source === d.dataset.src);
    if (!s) return;
    tip.innerHTML = srcTip(s);
    tip.hidden = false;
    const r = d.getBoundingClientRect();
    tip.style.top = r.bottom + 8 + 'px';
    tip.style.left = Math.max(8, Math.min(window.innerWidth - tip.offsetWidth - 8, r.left - 20)) + 'px';
  });
  document.addEventListener('mouseout', (e) => {
    if (e.target.closest && e.target.closest('.sdot[data-src]')) tip.hidden = true;
  });
  const topRo = new ResizeObserver(() => document.documentElement.style.setProperty('--topH', topHeight() + 'px'));
  for (const el of [$('top'), $('snapbar'), $('top').querySelector('.row2')]) topRo.observe(el);
  initSearch({
    open: (g) => go(g.league, g.game_id, S.tab),
    filter: () => render(),
  });
  if (STATIC) {
    document.documentElement.setAttribute('data-static', '1');
    onSnapshot(render);
    await ensureSnapshot();
  }
  try {
    const [meta, idx, src] = await Promise.all([api.meta(), api.index().catch(() => ({ games: [] })), api.sources().catch(() => ({ sources: [] }))]);
    setMeta(meta);
    ingestIndex(idx.games || []);
    S.sources = src.sources || [];
    if (S.mock && idx.generated_at) {
      S.clockOffset = Date.parse(idx.generated_at) - Date.now();
      window.__clockOffset = S.clockOffset;
    }
  } catch (e) {
    $('main').innerHTML = STATIC
      ? '<div class="empty-state">Could not load the latest snapshot. Try again in a minute.</div>'
      : '<div class="empty-state">Could not load the app data. Is the server running?</div>';
    return;
  }
  const r = parseHash();
  if (r.league) S.league = r.league;
  if (r.game) {
    S.sel = r.game;
    const lg = r.game.split('-')[0];
    if (S.leagueById[lg]) S.league = lg;
    if (r.tab) S.tab = r.tab;
    loadGame(r.game);
  }
  restartStream();
  render();
  setInterval(render, 15000);
  // Render/demo hooks: ?pop=sources|books|help and ?q=text open those overlays on load.
  if (params.get('hist')) { openHistory(S.tab, null); histRange(params.get('hist')); render(); }
  const pop = params.get('pop');
  if (pop === 'sources') sourcesPop($('srcbtn'));
  else if (pop === 'books') booksPop($('booksbtn'));
  else if (pop === 'help') toggleHelp(true);
  if (params.get('q')) {
    $('q').value = params.get('q');
    $('q').focus();
    $('q').dispatchEvent(new Event('input'));
    if (params.get('full') === '1') {
      S.fullSearch = true;
      $('sr').hidden = true;
      $('q').blur();
      render();
    }
  }
}

boot();
void leagueAccent;
void bookInfo;
void gridBooks;
void fmtCountdown;
