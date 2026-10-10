// Pure fuzzy matching of a free-text query against a game (both teams).

export function norm(s) {
  return String(s == null ? '' : s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function subseq(q, f) {
  let i = 0;
  for (let j = 0; j < f.length && i < q.length; j++) if (f[j] === q[i]) i++;
  return i === q.length;
}

function fieldScore(q, f) {
  if (!f) return 0;
  if (f === q) return 100;
  if (f.startsWith(q)) return 85;
  if (f.split(' ').some((w) => w.startsWith(q))) return 70;
  if (f.includes(q)) return 50;
  if (q.length >= 3 && subseq(q, f.replace(/ /g, ''))) return 20;
  return 0;
}

export function teamFields(team) {
  if (!team) return [];
  return [team.abbr, team.name, team.short, team.location, ...(team.aliases || [])].map(norm).filter(Boolean);
}

const STOP = new Set(['vs', 'v', 'at', 'the']);

// Returns 0 when the game does not match every token, else a positive score.
export function scoreGame(query, game) {
  const tokens = norm(query).split(' ').filter((t) => t && !STOP.has(t));
  if (!tokens.length) return 1;
  const fields = [...teamFields(game.home), ...teamFields(game.away), norm(game.league)];
  let total = 0;
  for (const t of tokens) {
    let best = 0;
    for (const f of fields) {
      const s = fieldScore(t, f);
      if (s > best) best = s;
    }
    if (!best) return 0;
    total += best;
  }
  return total;
}
