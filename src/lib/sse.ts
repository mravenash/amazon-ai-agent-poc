import type { CatalogItem } from '../store/chatStore';

export type OrderEventData = {
  orderId: string;
  item: CatalogItem;
  quantity: number;
  total: number;
};

export type CatalogEventData = {
  items: CatalogItem[];
};

export type StreamEvent =
  | { type: 'token'; data: string }
  | { type: 'order'; data: OrderEventData }
  | { type: 'catalog'; data: CatalogEventData };

export async function* sseChatStream(prompt: string, signal?: AbortSignal, clientId?: string): AsyncGenerator<StreamEvent> {
  // connection timeout for slow networks
  const connectCtrl = new AbortController();
  const timeoutId = setTimeout(() => connectCtrl.abort(new DOMException('Timeout', 'TimeoutError')), 8000);
  const onAbort = () => connectCtrl.abort(signal?.reason);
  signal?.addEventListener('abort', onAbort, { once: true });
  const resp = await fetch('http://localhost:8787/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, clientId }),
    signal: connectCtrl.signal,
  });
  clearTimeout(timeoutId);
  signal?.removeEventListener('abort', onAbort as any);
  if (!resp.body) return;
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      if (chunk.startsWith('event: ')) {
        const [, rest] = chunk.split('\n');
        const ev = chunk.slice(7, chunk.indexOf('\n'));
        if ((ev === 'order' || ev === 'catalog') && rest?.startsWith('data: ')) {
          const json = rest.slice(6).trim();
          try {
            const parsed = JSON.parse(json);
            if (ev === 'order') {
              yield { type: 'order', data: parsed as OrderEventData };
            } else if (ev === 'catalog') {
              yield { type: 'catalog', data: parsed as CatalogEventData };
            }
          } catch {
            /* no-op */
          }
        }
      } else if (chunk.startsWith('data: ')) {
        const data = chunk.slice(6);
        yield { type: 'token', data: data + ' ' };
      }
    }
  }
}

export async function* sseChatStreamWithRetry(
  prompt: string,
  opts?: { signal?: AbortSignal; retries?: number; clientId?: string; onRetry?: (info: { attempt: number; delayMs: number }) => void }
): AsyncGenerator<StreamEvent> {
  const retries = opts?.retries ?? 5;
  let attempt = 0;
  while (true) {
    try {
      for await (const chunk of sseChatStream(prompt, opts?.signal, opts?.clientId)) {
        yield chunk;
      }
      return; // completed
    } catch (e) {
      attempt++;
      if (opts?.signal?.aborted) throw e; // don't retry if caller aborted
      if (attempt > retries) throw e;
      const base = 300;
      const jitter = Math.floor(Math.random() * 200);
      const delay = Math.min(5000, base * Math.pow(2, attempt)) + jitter; // capped backoff + jitter
      opts?.onRetry?.({ attempt, delayMs: delay });
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}
