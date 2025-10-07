// Simple in-memory client cache with TTL for catalog search
const SEARCH_CACHE = new Map<string, { ts: number; data: { items: { id: string; title: string; price: number; image?: string }[] } }>();
const SEARCH_TTL_MS = 30_000; // 30s

function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit, timeoutMs = 8000, signal?: AbortSignal) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(new DOMException('Timeout', 'TimeoutError')), timeoutMs);
  const composite = new AbortController();
  const onAbort = () => composite.abort(signal?.reason);
  signal?.addEventListener('abort', onAbort, { once: true });
  const mergedSignal = composite.signal;
  // If either external signal or our timeout fires, abort
  ctrl.signal.addEventListener('abort', () => composite.abort(ctrl.signal.reason), { once: true });
  return fetch(input, { ...(init || {}), signal: mergedSignal }).finally(() => {
    clearTimeout(id);
    signal?.removeEventListener('abort', onAbort as any);
  });
}

export async function searchCatalog(query: string, opts?: { signal?: AbortSignal }) {
  const key = (query || '').trim().toLowerCase();
  const now = Date.now();
  const cached = SEARCH_CACHE.get(key);
  if (cached && now - cached.ts < SEARCH_TTL_MS) return cached.data;
  const u = new URL('http://localhost:8787/api/catalog/search');
  u.searchParams.set('q', query);
  const r = await fetchWithTimeout(u, undefined, 8000, opts?.signal);
  if (!r.ok) throw new Error('Search failed');
  const data = (await r.json()) as { items: { id: string; title: string; price: number; image?: string }[] };
  SEARCH_CACHE.set(key, { ts: now, data });
  return data;
}

export async function createOrder(itemId: string, quantity = 1, opts?: { signal?: AbortSignal }) {
  const r = await fetchWithTimeout('http://localhost:8787/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ itemId, quantity }),
  }, 8000, opts?.signal);
  if (!r.ok) throw new Error('Order failed');
  return (await r.json()) as { orderId: string; item: { id: string; title: string; price: number; image?: string }; quantity: number; total: number };
}
