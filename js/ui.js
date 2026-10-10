// Shared HTML-string helpers used by board, grid and drawer.
import { S, bookInfo, flashOf, abbrFor } from './state.js';
import { teamColors, operatorHue, needsRing } from './colors.js';
import { escapeHtml as esc, fmtAmerican, fmtLine, fmtTotal, fmtPct, americanToProb, hidesPrice } from './format.js';

export { esc };

// Sportsbook = square chip; prediction product = "%" pill. Same operator shares a hue.
// opts.long shows the full book name; opts.hue overrides the color (movement chart legend).
// Only http(s) links are ever followed.
export function safeUrl(u) {
  return typeof u === 'string' && /^https?:\/\//i.test(u) ? u : '';
}

export function bookChip(id, opts = {}) {
  const b = bookInfo(id);
  const href = safeUrl(opts.href);
  const hue = opts.hue || (b.kind === 'prediction' ? 'var(--pm)' : operatorHue(b.operator, b.id));
  const label = opts.long ? b.label : b.short;
  const cls = b.kind === 'prediction' ? 'bk bk-pred' : b.kind === 'reference' ? 'bk bk-ref' : 'bk bk-book';
  const glyph = b.kind === 'prediction' && !opts.noGlyph ? '<b>%</b>' : '';
  const intl = b.indicative ? ' bk-intl' : '';
  // D20: with a link the chip is an anchor that opens the book's page in a new tab (a small arrow shows on hover).
  if (href) return `<a class="${cls}${intl} bk-link" style="--bh:${hue}" data-bk="${esc(b.id)}" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${glyph}${esc(label)}<i class="xo">↗</i></a>`;
  return `<span class="${cls}${intl}" style="--bh:${hue}" data-bk="${esc(b.id)}">${glyph}${esc(label)}</span>`;
}

// Cells in the grid: a small arrow that opens the cell's link (Ctrl/Cmd-click on the cell does the same).
export function cellLink(url, label) {
  const u = safeUrl(url);
  return u ? `<a class="cl" href="${esc(u)}" target="_blank" rel="noopener noreferrer" title="Open at ${esc(label)}">↗</a>` : '';
}

// Keep the logo nodes that are already on screen: after a re-render, an <img> whose src is unchanged is swapped back in, so a live update never reloads or flashes a logo.
export function collectLogos(...roots) {
  const pool = new Map();
  for (const r of roots) {
    if (!r) continue;
    for (const im of r.querySelectorAll('img.tl')) {
      const k = im.getAttribute('src');
      if (!pool.has(k)) pool.set(k, []);
      pool.get(k).push(im);
    }
  }
  return pool;
}

export function reuseLogos(pool, ...roots) {
  if (!pool.size) return;
  for (const r of roots) {
    if (!r) continue;
    for (const im of r.querySelectorAll('img.tl')) {
      const list = pool.get(im.getAttribute('src'));
      const old = list && list.shift();
      if (!old) continue;
      old.className = im.className;
      im.replaceWith(old);
    }
  }
}

// ESPN serves its 500px logos through a resizer; ask for twice the shown size instead of the 300 KB original.
function logoSrc(url, px) {
  const m = /^https:\/\/a\.espncdn\.com(\/i\/teamlogos\/[^?]+)$/.exec(url);
  if (!m) return url;
  const d = Math.ceil((px * 2) / 8) * 8;
  return `https://a.espncdn.com/combiner/i?img=${m[1]}&w=${d}&h=${d}`;
}

// Team logo from ESPN. Hidden by a global error handler when it fails to load.
export function teamLogo(team, px = 18) {
  if (!team || !team.logo) return '';
  const ring = needsRing(team, S.theme) ? ' ring' : '';
  return `<img class="tl${ring}" src="${esc(logoSrc(team.logo, px))}" width="${px}" height="${px}" decoding="async" alt="">`;
}

export function teamPill(team) {
  const c = teamColors(team, S.theme);
  return `<span class="pill" style="--tc:${c.stripe};--tt:${c.text}">${esc(abbrFor(team))}</span>`;
}

// Team color as a CSS custom property for the soft row wash.
export function washStyle(team) {
  return `--tw:${teamColors(team, S.theme).stripe}`;
}

// Wrap the parts of text that the query's words match in <mark>.
export function hl(text, query) {
  const t = String(text == null ? '' : text);
  const toks = String(query || '').toLowerCase().split(/\s+/).filter((x) => x.length > 0);
  if (!toks.length) return esc(t);
  const low = t.toLowerCase();
  const spans = [];
  for (const k of toks) {
    const i = low.indexOf(k);
    if (i >= 0) spans.push([i, i + k.length]);
  }
  if (!spans.length) return esc(t);
  spans.sort((a, b) => a[0] - b[0]);
  const merged = [spans[0].slice()];
  for (const sp of spans.slice(1)) {
    const l = merged[merged.length - 1];
    if (sp[0] <= l[1]) l[1] = Math.max(l[1], sp[1]);
    else merged.push(sp.slice());
  }
  let out = '';
  let at = 0;
  for (const [a, b] of merged) {
    out += esc(t.slice(at, a)) + '<mark>' + esc(t.slice(a, b)) + '</mark>';
    at = b;
  }
  return out + esc(t.slice(at));
}

export function teamStripe(team) {
  return teamColors(team, S.theme).stripe;
}

export function priceText(american) {
  if (american == null) return '—';
  if (S.display === 'pct') return fmtPct(americanToProb(american));
  return fmtAmerican(american);
}

export function lineText(market, side, line) {
  if (line == null) return '';
  if (market === 'total') return fmtTotal(line, side);
  return fmtLine(line);
}

// Team name span: always the full name (D22); the CSS wraps it onto two lines when the column is narrow.
export function teamName(team) {
  const full = team.name || team.short || team.abbr;
  return `<span class="nm" title="${esc(full)}">${esc(full)}</span>`;
}

export function isPm(id) {
  return bookInfo(id).kind === 'prediction';
}

// D18: true when a sportsbook spread/total price is the standard -110 and is left out.
export function priceHidden(market, bookId, american) {
  return hidesPrice(market, bookInfo(bookId).kind, american);
}

// Price span; a hidden -110 keeps its width (invisible) so numbers do not jump.
export function priceSpan(market, bookId, american, cls = 'pr') {
  const t = esc(priceText(american));
  const pm = isPm(bookId) ? ' pmv' : '';
  return priceHidden(market, bookId, american) ? `<span class="${cls} pxh" aria-hidden="true">${t}</span>` : `<span class="${cls}${pm}">${t}</span>`;
}

// Plain "line price" string for hovers, search rows and key moves.
export function quoteStr(market, line, american, bookId, lineStr) {
  const p = priceHidden(market, bookId, american) ? '' : priceText(american);
  return [lineStr, p].filter((x) => x !== '' && x != null).join(' ');
}

// Off-market quote (far from the market line, never best): small marker.
export const OFF_TIP = 'Far from the market line — likely stale; never counted as best';
export function offMark() {
  return `<span class="off" title="${esc(OFF_TIP)}">⚠ off</span>`;
}

// Movement arrow for a keyed cell.
export function arrow(key, cell) {
  const f = flashOf(key, cell);
  if (!f) return '';
  return f.dir > 0 ? '<i class="mv up">▲</i>' : '<i class="mv dn">▼</i>';
}

export function flashClass(key, cell) {
  const f = flashOf(key, cell);
  if (!f || f.age >= 1200) return { cls: '', style: '' };
  return { cls: f.dir > 0 ? ' fl-up' : ' fl-dn', style: ` style="animation-delay:-${Math.round(f.age)}ms"` };
}

export function statusBadge(g) {
  if (g.status === 'live') return '<span class="st st-live">LIVE</span>';
  if (g.status === 'final') return '<span class="st st-final">FINAL</span>';
  if (g.status === 'postponed') return '<span class="st st-final">PPD</span>';
  return '';
}

export function gameMatchup(g) {
  return `${esc(abbrFor(g.away))} @ ${esc(abbrFor(g.home))}`;
}
