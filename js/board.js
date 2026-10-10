// Board view: game cards grouped by time slot; live and final games collapse into one strip per slot.
import { S, visibleGames, slotLabel, startMs, now, pickFor, isThreeWay, bookInfo, abbrFor, leagueAccent, mktLabel, beatsConsensus } from './state.js';
import { fmtCountdown, fmtPct, americanToProb } from './format.js';
import { esc, bookChip, teamPill, teamLogo, teamStripe, washStyle, lineText, arrow, flashClass, priceSpan, priceHidden, isPm, teamName, OFF_TIP } from './ui.js';

const CARD_MIN = 470; // full team names need a wide team column, so fewer cards per row rather than truncated names
const GAP = 12;

function cell(g, m, s) {
  const p = pickFor(g, m, s);
  const attrs = `data-g="${esc(g.game_id)}" data-m="${m}" data-s="${s}" data-ctx="${esc(g.game_id)}|${m}|${s}"`;
  if (!p || p.american == null) return `<div class="bc empty" ${attrs}>—</div>`;
  const first = (g.cells && g.cells[m] && g.cells[m][s] && g.cells[m][s][p.books[0]]) || null;
  const key = g.game_id + '|' + m + '|' + s + '|' + p.books[0];
  const fk = g.game_id + '|pick|' + m + '|' + s;
  const f = flashClass(fk, null);
  const f2 = f.cls ? f : flashClass(key, first);
  const kind = bookInfo(p.books[0]).kind;
  const showPct = S.display === 'both' || (kind === 'prediction' && S.display === 'odds');
  const line = m === 'moneyline' ? '' : `<span class="ln">${esc(lineText(m, s, p.line))}</span>`;
  const extra = p.books.length > 1 ? `<span class="tie">+${p.books.length - 1}</span>` : '';
  const pct = showPct && !extra ? `<span class="ip">${fmtPct(americanToProb(p.american), 0)}</span>` : '';
  // Green is reserved for real value: the best price beats the consensus line or price (D23: no fair price, no edge).
  const val = beatsConsensus(g, m, s, p) ? ' val' : '';
  const link = (p.links && p.links[p.books[0]]) || (first && first.link) || '';
  const pm = isPm(p.books[0]) ? ' pm' : '';
  const np = priceHidden(m, p.books[0], p.american) ? ' np' : '';
  const ml = m === 'moneyline' ? ' ml' : '';
  const off = first && first.off_market ? `<span class="offb" title="${esc(OFF_TIP)}">⚠</span>` : '';
  return `<div class="bc${ml}${val}${pm}${np}${f2.cls}" ${attrs}${f2.style}>${off}
    <div class="l1">${line}${priceSpan(m, p.books[0], p.american)}${arrow(key, first)}</div>
    <div class="l2">${bookChip(p.books[0], { noGlyph: true, href: link })}${extra}${pct}</div></div>`;
}

function teamRow(g, side) {
  const t = g[side];
  const cells = ['spread', 'moneyline', 'total'].map((m) => {
    if (m === 'total') return cell(g, 'total', side === 'away' ? 'over' : 'under');
    return cell(g, m, side);
  });
  return `<div class="tr" style="${washStyle(t)}" data-g="${esc(g.game_id)}" data-t="${side}">
    <div class="tn"><span class="lgs">${teamLogo(t, 20)}</span>${teamName(t)}</div>${cells.join('')}</div>`;
}

// The Draw row sits only in the Moneyline column; the Spread and Total cells beside it stay empty.
function drawRow(g) {
  const void_ = '<div class="bc void"></div>';
  return `<div class="tr draw" data-g="${esc(g.game_id)}">
    <div class="tn"><span class="dglyph"></span><span class="pill pill-draw">X</span><span class="nm">Draw</span></div>${void_}${cell(g, 'moneyline', 'draw')}${void_}</div>`;
}

function hasQuotes(g) {
  const c = g.cells || {};
  return Object.values(c).some((m) => Object.values(m).some((s) => Object.keys(s).length));
}

function noLines(g) {
  const msg = g.status === 'postponed' ? 'Postponed' : 'No lines posted yet';
  return `<div class="nolines" data-g="${esc(g.game_id)}"><div class="nl-msg">${msg}</div></div>`;
}

function card(g, idx) {
  const msTo = startMs(g) - now();
  const cd = g.status === 'scheduled' && msTo > 0 && msTo < 24 * 3600e3 ? `<span class="cd${msTo < 2 * 3600e3 ? ' soon' : ''}">${esc(fmtCountdown(msTo))}</span>` : '';
  const three = isThreeWay(g.league);
  const cls = 'card' + (idx === S.cursor ? ' cur' : '');
  const at = g.neutral ? 'vs' : '@';
  const neutral = g.neutral ? '<span class="neu" title="Neutral site">Neutral</span>' : '';
  return `<article class="${cls}" style="--ca:${teamStripe(g.away)};--cb:${teamStripe(g.home)}" data-g="${esc(g.game_id)}" data-idx="${idx}">
    <span class="tb"></span>
    <header class="ch"><b class="mt">${esc(abbrFor(g.away))} <i>${at}</i> ${esc(abbrFor(g.home))}</b>${neutral}<span class="sp"></span>${cd}</header>
    ${hasQuotes(g) ? `<div class="cols"><span></span><span>${mktLabel('spread', g.league)}</span><span>Moneyline</span><span>Total</span></div>
    ${teamRow(g, 'away')}${teamRow(g, 'home')}${three ? drawRow(g) : ''}` : noLines(g)}
  </article>`;
}

// D27: the score of a live or final game, the leader's in bold; '' when there is none.
function score(g, side) {
  if (g.status !== 'live' && g.status !== 'final') return '';
  const a = g.away_score;
  const h = g.home_score;
  if (!Number.isFinite(a) || !Number.isFinite(h)) return '';
  const mine = side === 'away' ? a : h;
  const lead = mine > (side === 'away' ? h : a) ? ' w' : '';
  return `<span class="sc${lead}">${mine}</span>`;
}

// Live and final games: one 28px chip each, clickable to the drawer.
function chip(g, idx) {
  const live = g.status === 'live';
  const word = live ? 'Live' : g.status === 'postponed' ? 'Postponed' : 'Final';
  const detail = live && g.status_detail ? ` <em>${esc(g.status_detail)}</em>` : '';
  const at = g.neutral ? 'vs' : '@';
  return `<button class="gchip ${live ? 'live' : 'fin'}${idx === S.cursor ? ' cur' : ''}" data-g="${esc(g.game_id)}" data-idx="${idx}" style="--ca:${teamStripe(g.away)};--cb:${teamStripe(g.home)}">
    ${teamLogo(g.away, 16)}<b>${esc(abbrFor(g.away))}</b>${score(g, 'away')}<i>${at}</i>${teamLogo(g.home, 16)}<b>${esc(abbrFor(g.home))}</b>${score(g, 'home')}<span class="gs">${live ? '<span class="ld"></span>' : ''}${word}${detail}</span></button>`;
}

function colCount(el) {
  const w = (el.clientWidth || window.innerWidth) - 32;
  // Draft: the one-line cells (variant A) need a wider card than the two-line cells (variant B); phones get one column either way.
  const min = window.innerWidth <= 600 ? CARD_MIN : 640;
  return Math.max(1, Math.floor((w + GAP) / (min + GAP)));
}

export function renderBoard(el) {
  const games = visibleGames();
  if (!S.boardLoaded[S.league]) {
    el.innerHTML = '<div class="empty-state">Loading games…</div>';
    return;
  }
  if (!games.length) {
    const why = S.query ? `No games match “${esc(S.query)}” in this league and window.` : 'No games in this window.';
    el.innerHTML = `<div class="empty-state">${why}<br><small>Try the All window or another league.</small></div>`;
    return;
  }
  const cols = colCount(el);
  const slots = [];
  let cur = null;
  games.forEach((g, i) => {
    const lab = slotLabel(g);
    if (!cur || cur.lab !== lab) {
      cur = { lab, items: [], status: g.status, strip: g.status !== 'scheduled' };
      slots.push(cur);
    }
    cur.items.push(cur.strip ? chip(g, i) : card(g, i));
  });
  const jump = slots.length >= 3
    ? `<nav class="jump" id="jump" aria-label="Jump to time slot"><span class="jl">Jump to</span>${slots
        .map((s, i) => `<button data-jump="slot-${i}" class="${s.status === 'live' ? 'live' : ''}">${s.status === 'live' ? '<span class="ld"></span>' : ''}${esc(s.lab.replace(/^Today · /, ''))}<small>${s.items.length}</small></button>`)
        .join('')}</nav>`
    : '';
  el.innerHTML = `${jump}<div class="bgrid" style="--cols:${cols};--lg:${leagueAccent(S.league)}">${slots
    .map((s, i) => {
      const span = s.strip ? cols : Math.min(cols, s.items.length); // Live and Final strips always span the full row
      const body = s.strip ? `<div class="strip" style="grid-column:1/-1">${s.items.join('')}</div>` : s.items.join('');
      return `<section class="slot s-${s.status}${s.strip ? ' stripslot' : ''}" id="slot-${i}" style="--span:${span}"><h3><span class="dot-s s-${s.status}"></span>${esc(s.lab)}<small>${s.items.length} game${s.items.length === 1 ? '' : 's'}</small></h3>${body}</section>`;
    })
    .join('')}</div>`;
  markJump();
}

// Highlight the jump chip of the slot nearest the top while scrolling.
export function markJump() {
  const j = document.getElementById('jump');
  if (!j) return;
  const limit = j.getBoundingClientRect().bottom + 12;
  let on = null;
  let bestTop = -1e9;
  document.querySelectorAll('.bgrid > .slot').forEach((s) => {
    const top = s.getBoundingClientRect().top;
    if (top <= limit && top > bestTop + 1) {
      on = s.id;
      bestTop = top;
    }
  });
  for (const b of j.querySelectorAll('button')) b.classList.toggle('on', b.dataset.jump === on);
}
