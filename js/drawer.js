// Drawer: full comparison for one game.
import { S, MARKETS, findGame, sidesFor, cmpQuote, isBest, isNear, pickFor, cellPrice, bookInfo, isThreeWay, leagueAccent, dayTimeLabel, startMs, now, abbrFor, mktLabel, clockLabel } from './state.js';
import { fmtAmerican, fmtLine, fmtTotal, fmtTotalNum, fmtPct, fmtAge,fmtCountdown, americanToProb, MINUS } from './format.js';
import { teamColors, headerColor, LINE_PALETTE } from './colors.js';
import { historyPanel } from './history.js';
import { esc, bookChip, teamPill, teamLogo, priceText, lineText, arrow, flashClass, statusBadge, priceSpan, priceHidden, isPm, offMark, OFF_TIP } from './ui.js';

const SIDE_NAME = { over: 'Over', under: 'Under', draw: 'Draw' };

function sideLabel(g, s) {
  return SIDE_NAME[s] || abbrFor(g[s]);
}

function sidePill(g, s) {
  if (s === 'home' || s === 'away') return teamPill(g[s]);
  return `<span class="pill pill-draw">${s === 'draw' ? 'X' : s === 'over' ? 'O' : 'U'}</span>`;
}

function header(g) {
  const a = headerColor(g.away);
  const h = headerColor(g.home);
  const msTo = startMs(g) - now();
  const cd = g.status === 'scheduled' && msTo > 0 && msTo < 2 * 3600e3 ? ` · ${fmtCountdown(msTo)}` : '';
  const lg = S.leagueById[g.league];
  // D27: live and final games show the score between the teams (away left, home right; leader bright).
  const as = g.away_score;
  const hs = g.home_score;
  const scored = (g.status === 'live' || g.status === 'final') && Number.isFinite(as) && Number.isFinite(hs);
  const mid = scored
    ? `<div class="at scored"><span class="dsc"><b class="${as > hs ? 'w' : ''}">${as}</b><i>–</i><b class="${hs > as ? 'w' : ''}">${hs}</b></span>${g.neutral ? '<small>Neutral site</small>' : ''}</div>`
    : `<div class="at">${g.neutral ? 'vs' : '@'}${g.neutral ? '<small>Neutral site</small>' : ''}</div>`;
  return `<div class="dh" style="--ta:${a};--th:${h}">
    <div class="dh-top"><span class="lgtag" style="--lg:${leagueAccent(g.league)}">${esc(lg ? lg.label : g.league)}</span>
      <span class="dh-time">${esc(dayTimeLabel(g))}${cd}</span>${statusBadge(g)}${g.status_detail && g.status !== 'scheduled' ? `<span class="sd">${esc(g.status_detail)}</span>` : ''}
      <span class="sp"></span>
      <button class="ib" data-act="prev" title="Previous game [">‹</button><button class="ib" data-act="next" title="Next game ]">›</button><button class="ib" data-act="close" title="Close (Esc)">✕</button></div>
    <div class="dh-teams">
      <div class="dt">${teamLogo(g.away, 44)}<div><b>${esc(abbrFor(g.away))}</b><span>${esc(g.away.name)}</span></div></div>
      ${mid}
      <div class="dt r">${teamLogo(g.home, 44)}<div><b>${esc(abbrFor(g.home))}</b><span>${esc(g.home.name)}</span></div></div>
    </div></div>`;
}

function summary(g) {
  return `<div class="sum">${MARKETS.map((m) => {
    const sides = sidesFor(m, g.league);
    const rows = sides
      .map((s) => {
        const p = pickFor(g, m, s);
        if (!p) return `<div class="srow" data-hm="${m}" data-hs="${s}"><span class="sl">${esc(sideLabel(g, s))}</span><span class="sv na">—</span></div>`;
        const ln = m === 'moneyline' ? '' : `<span class="ln">${esc(lineText(m, s, p.line))}</span>`;
        const tie = p.books.length > 1 ? `<span class="tie">+${p.books.length - 1}</span>` : '';
        const first = (g.cells && g.cells[m] && g.cells[m][s] && g.cells[m][s][p.books[0]]) || null;
        const link = (p.links && p.links[p.books[0]]) || (first && first.link) || '';
        return `<div class="srow" data-hm="${m}" data-hs="${s}" title="Show line history"><span class="sl">${esc(sideLabel(g, s))}</span><span class="sv">${ln}${priceSpan(m, p.books[0], p.american)}</span>${bookChip(p.books[0], { href: link })}${tie}</div>`;
      })
      .join('');
    return `<button class="sbox${S.tab === m ? ' on' : ''}" data-act="tab" data-tab="${m}"><h4><span>${mktLabel(m, g.league)}</span><span class="hbtn" role="button" data-hm="${m}" data-hs="">History</span></h4>${rows}</button>`;
  }).join('')}</div>`;
}

function openRef(g, m, s, book) {
  const o = g.open && g.open[m] && g.open[m][s];
  if (!o) return null;
  return o[book] || o.open || null;
}

function pane(g, m, s) {
  const cells = (g.cells && g.cells[m] && g.cells[m][s]) || {};
  const ids = Object.keys(cells);
  const real = ids.filter((id) => bookInfo(id).kind !== 'reference');
  const refs = ['consensus'].filter((id) => cells[id]);
  const rank = (id) => {
    const c = cells[id];
    return c.stale || c.alt || c.off_market ? 1 : 0;
  };
  real.sort((a, b) => {
    const ca = cells[a];
    const cb = cells[b];
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    if (isBest(ca) !== isBest(cb)) return isBest(ca) ? -1 : 1;
    const d = cmpQuote(m, s, cb, ca);
    return d || bookInfo(a).order - bookInfo(b).order;
  });
  const hasLine = m !== 'moneyline';
  const row = (id, ref) => {
    const c = cells[id];
    const b = bookInfo(id);
    const key = `${g.game_id}|${m}|${s}|${id}`;
    const fl = flashClass(key, c);
    const cls = [ref ? 'ref' : '', isBest(c) ? 'best' : isNear(c) ? 'near' : '', c.stale ? 'stale' : '', c.alt ? 'alt' : '', b.indicative ? 'ind' : '', isPm(id) ? 'pm' : '', c.off_market ? 'offm' : '', fl.cls.trim()]
      .filter(Boolean).join(' ');
    const fresh = ref ? '' : `<i class="fd ${c.stale ? 'st' : 'ok'}" title="${c.stale ? 'Stale quote' : 'Fresh'}"></i>`;
    const ln = hasLine ? `<td class="n">${c.line == null ? '—' : esc(m === 'total' ? fmtTotalNum(c.line) : fmtLine(c.line))}</td>` : '';
    const note = c.alt && c.rung_note ? `<span class="alt-note" title="${esc(c.rung_note)}">alt</span>` : '';
    const bookName = ref ? `<span class="rl">${esc(b.label)}</span>` : `${bookChip(id, { long: true, href: c.link })}${note}${c.off_market ? offMark() : ''}`;
    const shown = c.american;
    return `<tr class="${cls}"${fl.style} data-ctx="${esc(g.game_id)}|${m}|${s}" data-bk="${esc(id)}"><td class="bkc">${fresh}${bookName}</td>${ln}<td class="n pr${isPm(id) ? ' pmv' : ''}"${c.off_market ? ` title="${esc(OFF_TIP)}"` : ''}>${priceHidden(m, id, shown) ? '' : esc(priceText(shown))}${arrow(key, c)}</td>
      <td class="n imp">${esc(fmtPct(c.implied != null ? c.implied : americanToProb(shown)))}</td>
      <td class="n age${c.stale ? ' amber' : ''}">${c.stale ? 'stale ' : ''}${esc(fmtAge(c.age_s))}</td></tr>`;
  };
  const missing = S.books.filter((b) => b.enabled && b.kind !== 'reference' && !cells[b.id]).map((b) => b.short);
  const books = real.filter((id) => !isPm(id));
  const pms = real.filter((id) => isPm(id));
  // D23: prediction markets first, then the sportsbooks, then the consensus row last.
  const span = hasLine ? 5 : 4;
  const both = pms.length && books.length;
  const grp = (t, k) => (both ? `<tr class="grp ${k}"><td colspan="${span}">${t}</td></tr>` : '');
  const body = (pms.length ? grp('Prediction markets', 'pmg') + pms.map((id) => row(id, false)).join('') : '') + (books.length ? grp('Sportsbooks', 'bkg') + books.map((id) => row(id, false)).join('') : '') + refs.map((id, i) => row(id, true).replace('<tr class="', `<tr class="${i === 0 ? 'sep ' : ''}`)).join('');
  const p = pickFor(g, m, s);
  const bestTxt = p ? `<span class="pbest">${hasLine ? esc(lineText(m, s, p.line)) + ' ' : ''}${priceHidden(m, p.books[0], p.american) ? '' : esc(priceText(p.american))}</span>` : '';
  return `<div class="pane${m === 'moneyline' && s === 'draw' ? ' draw' : ''}"><div class="ph">${s === 'home' || s === 'away' ? teamLogo(g[s], 20) : ''}${sidePill(g, s)}<b>${esc(s === 'home' || s === 'away' ? g[s].name : sideLabel(g, s))}</b>${s === 'home' || s === 'away' ? `<span class="hint">${s}</span>` : ''}<span class="sp"></span>${bestTxt}</div>
    <table class="bt"><colgroup><col class="c-bk">${hasLine ? '<col class="c-ln">' : ''}<col class="c-pr"><col class="c-ip"><col class="c-ag"></colgroup>
    <thead><tr><th>Book</th>${hasLine ? '<th class="n">Line</th>' : ''}<th class="n sorted" title="Sorted best price first">Price ▾</th><th class="n">Impl</th><th class="n">Age</th></tr></thead>
    <tbody>${body || `<tr><td colspan="${hasLine ? 5 : 4}" class="empty-row">No quotes</td></tr>`}</tbody></table>
    ${missing.length ? `<div class="miss">No quote: ${esc(missing.join(', '))}</div>` : ''}</div>`;
}

function ladders(g, m) {
  if (m === 'moneyline' || !g.ladders) return '';
  const names = { kalshi: 'Kalshi', poly: 'Poly (intl)', polyus: 'Polymarket US' };
  const blocks = Object.keys(g.ladders)
    .filter((k) => g.ladders[k] && g.ladders[k][m] && g.ladders[k][m].length)
    .map((k) => {
      const rungs = g.ladders[k][m];
      const isS = m === 'spread';
      const head = isS ? `<th class="n">${esc(g.home.abbr)} line</th><th class="n">${esc(g.home.abbr)}</th><th class="n">${esc(g.away.abbr)}</th>` : '<th class="n">Total</th><th class="n">Over</th><th class="n">Under</th>';
      const body = rungs
        .map((r) => {
          const a = isS ? r.home : r.over;
          const b = isS ? r.away : r.under;
          const ln = isS ? fmtLine(r.line_home) : fmtTotalNum(r.line);
          return `<tr class="${r.anchor ? 'anchor' : ''}"><td class="n">${esc(ln)}</td><td class="n">${esc(priceText(a))}</td><td class="n">${esc(priceText(b))}</td></tr>`;
        })
        .join('');
      return `<div class="lad"><div class="lh">${bookChip(k, { long: true })}<span class="hint">ladder · quoted</span></div>
        <table class="bt lt"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
    });
  if (!blocks.length) return '';
  void names;
  return `<section class="dsec"><h5>Exchange ladders <small>anchor rung outlined</small></h5><div class="lads">${blocks.join('')}</div></section>`;
}

function sparkline(g, m, s) {
  const hist = g.history || {};
  const prefix = `${m}.${s}.`;
  const series = Object.keys(hist)
    .filter((k) => k.startsWith(prefix) && hist[k].length >= 2)
    .map((k) => ({
      book: k.slice(prefix.length),
      pts: hist[k].map((p) => ({ t: p[0], v: m === 'moneyline' ? (p[2] == null ? null : americanToProb(p[2]) * 100) : p[1] })).filter((p) => p.v != null),
    }))
    .filter((x) => x.pts.length >= 2);
  const cells = (g.cells && g.cells[m] && g.cells[m][s]) || {};
  const open = openRef(g, m, s, 'open');
  const cons = cells.consensus;
  let oc = '';
  if (open && cons) {
    const o = m === 'moneyline' ? fmtAmerican(open.american) : lineText(m, s, open.line);
    const n = m === 'moneyline' ? fmtAmerican(cons.american) : lineText(m, s, cons.line);
    oc = `<span class="oc">Open <b>${esc(o)}</b> → now <b>${esc(n)}</b></span>`;
  }
  if (!series.length) return `<div class="spk"><div class="sh">${sidePill(g, s)}<b>${esc(sideLabel(g, s))}</b>${oc}</div><div class="miss">No movement history yet</div></div>`;
  const W = 300;
  const H = 76;
  const pad = 6;
  const all = series.flatMap((x) => x.pts);
  const t0 = Math.min(...all.map((p) => p.t));
  const t1 = Math.max(...all.map((p) => p.t));
  let v0 = Math.min(...all.map((p) => p.v));
  let v1 = Math.max(...all.map((p) => p.v));
  if (v1 - v0 < 1e-6) {
    v0 -= 0.5;
    v1 += 0.5;
  }
  const X = (t) => pad + ((t - t0) / Math.max(1, t1 - t0)) * (W - 2 * pad - 24);
  const Y = (v) => H - pad - ((v - v0) / (v1 - v0)) * (H - 2 * pad);
  series.forEach((x, i) => (x.col = LINE_PALETTE[i % LINE_PALETTE.length]));
  const paths = series
    .map((x) => {
      const col = x.col;
      let d = '';
      x.pts.forEach((p, i) => {
        d += i === 0 ? `M${X(p.t).toFixed(1)} ${Y(p.v).toFixed(1)}` : `H${X(p.t).toFixed(1)}V${Y(p.v).toFixed(1)}`;
      });
      const last = x.pts[x.pts.length - 1];
      return `<path d="${d}" fill="none" stroke="${col}" stroke-width="1.6" stroke-linejoin="round"/><circle cx="${X(last.t).toFixed(1)}" cy="${Y(last.v).toFixed(1)}" r="2.4" fill="${col}"/>`;
    })
    .join('');
  const fmtV = (v) => (m === 'moneyline' ? v.toFixed(0) + '%' : m === 'total' ? fmtTotalNum(v) : fmtLine(v));
  const legend = series.map((x) => bookChip(x.book, { hue: x.col })).join('');
  return `<div class="spk"><div class="sh">${sidePill(g, s)}<b>${esc(sideLabel(g, s))}</b>${oc}</div>
    <svg viewBox="0 0 ${W} ${H}" class="svg-spk" role="img" aria-label="Line movement">
      <line x1="${pad}" x2="${W - 24}" y1="${H - pad}" y2="${H - pad}" class="ax"/>${paths}
      <text x="${W - 2}" y="${(Y(v1) + 3).toFixed(0)}" text-anchor="end" class="ay">${esc(fmtV(v1))}</text>
      <text x="${W - 2}" y="${(Y(v0) + 3).toFixed(0)}" text-anchor="end" class="ay">${esc(fmtV(v0))}</text></svg>
    <div class="lg">${legend}</div></div>`;
}

function updated(g) {
  const c = g.updated_at ? clockLabel(g.updated_at) : null;
  if (!c) return '';
  return `Updated ${esc(c.when)} · ${esc(fmtAge(c.age))} ago.`;
}

export function renderDrawer(el) {
  const g = findGame(S.sel);
  if (!g) {
    el.innerHTML = '<div class="empty-state">Loading game…</div>';
    return;
  }
  const m = S.tab;
  const sides = sidesFor(m, g.league);
  const three = sides.length === 3;
  const prevDb = el.querySelector('.db');
  const prevScroll = prevDb ? prevDb.scrollTop : 0;
  const tabs = MARKETS.map((x, i) => `<button class="tab${x === m ? ' on' : ''}" data-act="tab" data-tab="${x}">${mktLabel(x, g.league)}<kbd>${i + 1}</kbd></button>`).join('');
  const gone = S.gone.has(g.game_id) ? '<div class="gone">This game is no longer listed. Showing the last prices received.</div>' : '';
  el.innerHTML = `${header(g)}<div class="db">${gone}${summary(g)}
    ${historyPanel(g, m, (prevDb ? prevDb.clientWidth : el.clientWidth - 16) - 36)}
    <div class="tabs">${tabs}<span class="sp"></span><span class="legend"><i class="lg-b"></i>best <i class="lg-n"></i>near <i class="lg-s"></i>stale <i class="lg-a"></i>alt line <span class="lg-off">⚠ off-market</span> <i class="lg-pm"></i>prediction market <span class="lg-m">Line alone = −110</span></span></div>
    <div class="panes p${sides.length}${three ? ' soccer' : ''}">${sides.map((s) => pane(g, m, s)).join('')}</div>
    ${ladders(g, m)}
    <section class="dsec"><h5>Movement <small>stepped line history per book</small></h5><div class="spks p${Math.min(sides.length, 3)}">${sides.filter((s) => s !== 'draw' || true).map((s) => sparkline(g, m, s)).join('')}</div></section>
    <div class="foot">Prediction-market prices are shown as quoted.${updated(g)}</div></div>`;
  const db = el.querySelector('.db');
  if (db) db.scrollTop = prevScroll;
  void MINUS;
  void fmtTotal;
  void teamColors;
  void isThreeWay;
  void cellPrice;
}
