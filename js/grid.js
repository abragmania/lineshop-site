// Grid view: one fixed-width column per enabled book, rows = teams grouped per game.
import { S, visibleGames, slotLabel, timeLabel, sidesFor, pickFor, isBest, isNear, cellPrice, bookInfo, leagueAccent, startMs, abbrFor } from './state.js';
import { fmtLine, fmtTotalNum, fmtPct, americanToProb } from './format.js';
import { esc, bookChip, teamPill, teamLogo, washStyle, arrow, flashClass, priceSpan, teamName, cellLink, safeUrl, OFF_TIP } from './ui.js';

const MKT_TAG = { spread: 'SPR', moneyline: 'ML', total: 'TOT' };

export function gridBooks() {
  return S.books.filter((b) => b.enabled && b.id !== 'open' && !S.hiddenBooks.has(b.id));
}

function rowsFor(g) {
  const ms = S.market === 'all' ? ['spread', 'moneyline', 'total'] : [S.market];
  const out = [];
  for (const m of ms) for (const s of sidesFor(m, g.league)) out.push({ m, s });
  return out;
}

// Line and price in fixed-width tabular spans so every column lines up.
function cellHtml(m, c, bookId) {
  const p = priceSpan(m, bookId, cellPrice(c));
  if (m === 'moneyline') return `<span class="ln"></span>${p}`;
  const ln = m === 'spread' ? fmtLine(c.line) : fmtTotalNum(c.line);
  return `<span class="ln">${esc(ln)}</span>${p}`;
}

function teamCell(g, m, s) {
  if (s === 'home' || s === 'away') {
    const t = g[s];
    return `<div class="tcw">${teamLogo(t, 16)}${teamPill(t)}${teamName(t)}</div>`;
  }
  if (s === 'draw') return '<div class="tcw"><span class="pill pill-draw">X</span><span class="nm">Draw</span></div>';
  return `<span class="ou ${s}">${s === 'over' ? 'Over' : 'Under'}</span><span class="mu">${esc(abbrFor(g.away))}@${esc(abbrFor(g.home))}</span>`;
}

function bestCell(g, m, s) {
  const p = pickFor(g, m, s);
  if (!p) return '<td class="bst na">—</td>';
  const ctx = `${esc(g.game_id)}|${m}|${s}`;
  const ln = m === 'moneyline' ? '' : (m === 'spread' ? fmtLine(p.line) : fmtTotalNum(p.line)) + ' ';
  const price = priceSpan(m, p.books[0], p.american, 'bp');
  const tie = p.books.length > 1 ? `<span class="tie">+${p.books.length - 1}</span>` : '';
  return `<td class="bst" data-ctx="${ctx}"><span class="bv">${esc(ln)}${price}</span>${bookChip(p.books[0])}${tie}</td>`;
}

function gameRows(g, cols) {
  const rows = rowsFor(g);
  const all = S.market === 'all';
  return rows
    .map((r, i) => {
      const first = i === 0;
      const newM = all && (i === 0 || rows[i - 1].m !== r.m);
      const cells = (g.cells && g.cells[r.m] && g.cells[r.m][r.s]) || {};
      const tds = cols
        .map((b) => {
          const c = cells[b.id];
          const ref = b.kind === 'reference' ? ' ref' : '';
          if (!c || c.american == null) return `<td class="n na${ref}">—</td>`;
          const key = `${g.game_id}|${r.m}|${r.s}|${b.id}`;
          const fl = flashClass(key, c);
          const cls = ['n', ref.trim(), isBest(c) ? 'best' : isNear(c) ? 'near' : '', c.stale ? 'stale' : '', c.alt ? 'alt' : '', b.indicative ? 'ind' : '', b.kind === 'prediction' ? 'pm' : '', c.off_market ? 'offm' : '', fl.cls.trim()]
            .filter(Boolean).join(' ');
          const tip = `${c.off_market ? OFF_TIP + ' · ' : ''}${b.label}${c.stale ? ' (stale)' : ''}${c.rung_note ? ' · ' + c.rung_note : ''} · ${fmtPct(c.implied != null ? c.implied : americanToProb(c.american))}`;
          const link = safeUrl(c.link);
          return `<td class="${cls}${link ? ' lk' : ''}"${fl.style} title="${esc(tip)}${link ? ' · Ctrl-click opens ' + esc(b.label) : ''}"${link ? ` data-link="${esc(link)}"` : ''}>${cellHtml(r.m, c, b.id)}${arrow(key, c)}${cellLink(link, b.label)}</td>`;
        })
        .join('');
      const cls = 'gr' + (first ? ' g0' : '') + (newM && !first ? ' m0' : '') + (g.status !== 'scheduled' ? ' off' : '');
      return `<tr class="${cls}" data-g="${esc(g.game_id)}" data-m="${r.m}" style="--lg:${leagueAccent(g.league)}">
        <td class="c-time">${first ? `<b>${esc(timeLabel(g))}</b>` : ''}</td>${all ? `<td class="c-mkt">${newM ? MKT_TAG[r.m] : ''}</td>` : ''}
        <td class="c-team"${r.s === 'home' || r.s === 'away' ? ` style="${washStyle(g[r.s])}"` : ''}>${teamCell(g, r.m, r.s)}</td>${bestCell(g, r.m, r.s)}${tds}</tr>`;
    })
    .join('');
}

function sortGames(games) {
  const k = S.sort.key;
  const d = S.sort.dir;
  const arr = games.slice();
  if (k === 'team') arr.sort((a, b) => d * a.away.name.localeCompare(b.away.name));
  else if (d < 0) arr.reverse();
  return arr;
}

export function renderGrid(el) {
  if (!S.boardLoaded[S.league]) {
    el.innerHTML = '<div class="empty-state">Loading games…</div>';
    return;
  }
  const games = visibleGames();
  if (!games.length) {
    el.innerHTML = `<div class="empty-state">${S.query ? 'No games match “' + esc(S.query) + '”.' : 'No games in this window.'}</div>`;
    return;
  }
  const cols = gridBooks();
  const all = S.market === 'all';
  const sorted = S.sort.key === 'time' && S.sort.dir === 1 ? games : sortGames(games);
  const head = cols
    .map((b) => `<th class="n${b.kind === 'reference' ? ' ref' : ''}${b.kind === 'prediction' ? ' pm' : ''}" title="${esc(b.label)}${b.note ? ' · ' + esc(b.note) : ''}">${bookChip(b.id, { noGlyph: true })}</th>`)
    .join('');
  const arrowFor = (k) => (S.sort.key === k ? (S.sort.dir > 0 ? ' ▴' : ' ▾') : '');
  const nCols = (all ? 1 : 0) + 3 + cols.length;
  let body = '';
  let lastSlot = null;
  for (const g of sorted) {
    if (S.sort.key === 'time') {
      const lab = slotLabel(g);
      if (lab !== lastSlot) {
        body += `<tr class="gslot"><td colspan="${nCols}"><div>${esc(lab)}</div></td></tr>`;
        lastSlot = lab;
      }
    }
    body += gameRows(g, cols);
  }
  const leg = cols
    .map((b) => `<span class="gl">${bookChip(b.id, { noGlyph: true })}<em>${esc(b.label)}</em></span>`)
    .join('');
  el.innerHTML = `<div class="gbox"><div class="gwrap${all ? ' all' : ''}"><table class="grid" style="--nbk:${cols.length}">
    <colgroup><col class="k-time">${all ? '<col class="k-mkt">' : ''}<col class="k-team"><col class="k-best">${cols.map(() => '<col class="k-bk">').join('')}</colgroup>
    <thead><tr><th class="c-time sortable${S.sort.key === 'time' ? ' on' : ''}" data-sort="time">Time${arrowFor('time')}</th>${all ? '<th class="c-mkt">Mkt</th>' : ''}
      <th class="c-team sortable${S.sort.key === 'team' ? ' on' : ''}" data-sort="team">Team${arrowFor('team')}</th>
      <th class="bst">Best</th>${head}</tr></thead>
    <tbody>${body}</tbody></table></div><div class="gleg">${leg}</div></div>`;
}
