// Transport: REST + SSE against the server, or the mock when ?mock=1.
import { mockApi } from './mock.js';
import { STATIC, staticApi } from './staticapi.js';

async function j(url) {
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(url + ' ' + r.status);
  return r.json();
}

// The "All" chip asks the server for every listed game; every other chip is served from the 24 h window.
function serverWindow(win) {
  return win === 'all' ? 'all' : '24h';
}

const liveApi = {
  meta: () => j('api/meta'),
  index: () => j('api/index'),
  sources: () => j('api/sources'),
  board: (lg, win) => j('api/board?league=' + encodeURIComponent(lg) + '&window=' + serverWindow(win)),
  game: (id) => j('api/game/' + encodeURIComponent(id)),
  history: (id, m, side, range) => j('api/history/' + encodeURIComponent(id) + '?market=' + m + '&side=' + side + '&range=' + range),
  // emit(type, data); status(boolean connected). Returns a closer.
  stream(params, emit, status) {
    let url = 'api/stream?league=' + encodeURIComponent(params.league);
    if (params.game) url += '&game=' + encodeURIComponent(params.game);
    url += '&window=' + serverWindow(params.win);
    const es = new EventSource(url);
    es.onopen = () => status(true);
    es.onerror = () => status(false);
    for (const type of ['board', 'games', 'detail', 'index', 'sources']) {
      es.addEventListener(type, (ev) => {
        try {
          emit(type, JSON.parse(ev.data));
        } catch (e) {
          /* ignore malformed event */
        }
      });
    }
    return () => es.close();
  },
};

export function createApi(mock) {
  if (STATIC) return staticApi;
  return mock ? mockApi : liveApi;
}
