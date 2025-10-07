import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { BedrockRuntimeClient, InvokeModelWithResponseStreamCommand } from '@aws-sdk/client-bedrock-runtime';
import fs from 'fs';
import path from 'path';

export function createApp() {
  dotenv.config();

  const useBedrock = !!process.env.BEDROCK_MODEL_ID;
  const usePublicCatalog = (process.env.PUBLIC_CATALOG_SOURCE || '').toLowerCase() === 'dummyjson';
  const imageSource = (process.env.IMAGE_SOURCE || 'catalog').toLowerCase(); // 'unsplash' | 'picsum' | 'catalog'
  let bedrock;
  if (useBedrock) {
    bedrock = new BedrockRuntimeClient({ region: process.env.AWS_REGION || 'us-east-1' });
  }

  const app = express();
  app.use(cors());
  app.use(express.json());
  // Simple in-memory cache for search results with TTL (node process-local)
  const searchCache = new Map(); // key -> { ts, items }
  const SEARCH_TTL_MS = 30_000; // 30s

  // Fuzzy tolerance knobs (env)
  const FUZZY_SHORT_MAX_DISTANCE = Number(process.env.FUZZY_SHORT_MAX_DISTANCE || 1);
  const FUZZY_LONG_MAX_DISTANCE = Number(process.env.FUZZY_LONG_MAX_DISTANCE || 2);

  // --- Catalog source & orders ---
  const dataDir = path.resolve(process.cwd(), 'server', 'data');
  const catalogPath = path.join(dataDir, 'catalog.json');
  const ordersPath = path.join(dataDir, 'orders.json');
  const loadCatalog = () => JSON.parse(fs.readFileSync(catalogPath, 'utf-8'));
  const loadOrders = () => JSON.parse(fs.readFileSync(ordersPath, 'utf-8'));
  const saveOrders = (orders) => fs.writeFileSync(ordersPath, JSON.stringify(orders, null, 2));
  let catalog = loadCatalog();

  // Auto-reload catalog when the JSON file changes (dev convenience)
  try {
    fs.watchFile?.(catalogPath, { interval: 500 }, () => {
      try {
        catalog = loadCatalog();
        // eslint-disable-next-line no-console
        console.log('[server] catalog reloaded from disk');
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[server] failed to reload catalog:', e);
      }
    });
  } catch {}

  // in-memory pending orders per clientId: { item, quantity }
  const pendingOrders = new Map();

  // --- Search helpers (synonyms + token-group matching) ---
  const SYNONYMS = {
    earphone: ['earphones', 'earbuds', 'buds', 'in-ear', 'iem', 'headphones'],
    earbuds: ['earbuds', 'buds', 'earphones', 'in-ear', 'iem'],
    headphone: ['headphone', 'headphones', 'over-ear', 'on-ear'],
    airpod: ['airpod', 'airpods', 'air pod', 'air pods'],
    sony: ['sony', 'wf-1000xm5', 'xm5'],
    samsung: ['samsung', 'galaxy', 'buds'],
    beats: ['beats', 'studio buds', 'buds'],
  earins: ['earbuds', 'earphones'], // simple typo alias
  };
  const makeGroups = (s) => {
    const tokens = String(s)
      .toLowerCase()
      .split(/\s+/)
      // ignore empty and non-alphanumeric tokens (e.g., '?')
      .filter((t) => /[a-z0-9]/i.test(t));
    return tokens.map((t) => {
      const key = t.replace(/s\b/, ''); // naive singular
      const list = SYNONYMS[key] || [];
      return Array.from(new Set([t, ...list]));
    });
  };
  const itemHay = (item) => [item.title, item.id, ...(Array.isArray(item.keywords) ? item.keywords : [])]
    .join(' ').toLowerCase();
  const matchesGroups = (item, groups) => {
    const hay = itemHay(item);
    return groups.length === 0 || groups.every((g) => g.some((t) => hay.includes(t)));
  };
  // Fuzzy helpers for minor typos
  const levenshtein = (a, b) => {
    a = String(a || '').toLowerCase();
    b = String(b || '').toLowerCase();
    const m = a.length, n = b.length;
    if (m === 0) return n; if (n === 0) return m;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + cost
        );
      }
    }
    return dp[m][n];
  };
  const nearIncludes = (hay, token) => {
    if (!token) return true;
    if (hay.includes(token)) return true;
    const words = hay.split(/[^a-z0-9]+/).filter(Boolean);
  const maxDist = token.length <= 4 ? FUZZY_SHORT_MAX_DISTANCE : FUZZY_LONG_MAX_DISTANCE;
    return words.some((w) => Math.abs(w.length - token.length) <= 2 && levenshtein(w, token) <= maxDist);
  };
  const matchesFuzzy = (item, tokens) => {
    const hay = itemHay(item);
    return tokens.length === 0 || tokens.every((t) => nearIncludes(hay, t));
  };

  // Public catalog (DummyJSON) helpers
  const mapDummy = (p) => ({
    id: `D${p.id}`,
    title: p.title,
    price: p.price,
    image: p.thumbnail || (Array.isArray(p.images) ? p.images[0] : undefined),
  });
  async function dummySearch(q) {
    const url = `https://dummyjson.com/products/search?q=${encodeURIComponent(q || '')}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error('dummyjson search failed');
    const data = await r.json();
    const products = Array.isArray(data.products) ? data.products : [];
    return products.map(mapDummy);
  }
  async function dummyGetById(id) {
    const n = String(id).startsWith('D') ? String(id).slice(1) : String(id);
    const url = `https://dummyjson.com/products/${encodeURIComponent(n)}`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const p = await r.json();
    if (!p || !p.id) return null;
    return mapDummy(p);
  }

  // image helpers (scoped to access imageSource)
  function sanitizeTitle(t) {
    return String(t || '')
      .replace(/[()]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  function buildUnsplashUrl(title) {
    const q = encodeURIComponent(sanitizeTitle(title));
    return `https://source.unsplash.com/featured/240x180?${q}`;
  }
  function buildPicsumUrl(id) {
    const seed = encodeURIComponent(String(id || 'placeholder'));
    return `https://picsum.photos/seed/${seed}/240/180`;
  }
  function applyImage(item) {
    const img = item?.image;
    if (imageSource === 'catalog' && img) return item;
    const next = { ...item };
    if (imageSource === 'picsum') {
      next.image = buildPicsumUrl(item.id);
    } else if (imageSource === 'unsplash') {
      next.image = buildUnsplashUrl(item.title);
    } else {
      next.image = img || buildPicsumUrl(item.id);
    }
    return next;
  }

  app.get('/api/catalog/search', async (req, res) => {
    try {
      const q = (req.query.q || '').toString().toLowerCase();
      const now = Date.now();
      const cacheKey = JSON.stringify({ q, usePublicCatalog, imageSource });
      const cached = searchCache.get(cacheKey);
      if (cached && (now - cached.ts < SEARCH_TTL_MS)) {
        return res.json({ items: cached.items });
      }
      const groups = makeGroups(q);
      if (usePublicCatalog) {
        const items = await dummySearch(q);
        // For public catalog, we can't rely on keywords; require each token group to match title or id
        const filtered = items.filter((it) => {
          const hay = [it.title, it.id].join(' ').toLowerCase();
          return groups.length === 0 || groups.every((group) => group.some((t) => hay.includes(t)));
        });
        const out = filtered.map(applyImage);
        searchCache.set(cacheKey, { ts: now, items: out });
        return res.json({ items: out });
      }
      let results = q ? catalog.filter((p) => matchesGroups(p, groups)) : catalog.slice(0, 5);
      // Fallback: fuzzy check on raw tokens when strict groups yield no results
      if (q && results.length === 0) {
        const rawTokens = String(q).toLowerCase().split(/\s+/).filter(Boolean);
        results = catalog.filter((p) => matchesFuzzy(p, rawTokens));
      }
      const out = results.map(applyImage);
      searchCache.set(cacheKey, { ts: now, items: out });
      return res.json({ items: out });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('search error', e);
      return res.status(500).json({ error: 'search failed' });
    }
  });

  app.get('/api/orders', (_req, res) => {
    const orders = loadOrders();
    res.json({ orders });
  });

  app.post('/api/orders', async (req, res) => {
    const { itemId, quantity } = req.body || {};
    const qty = Number(quantity) || 1;
    let item;
    if (usePublicCatalog) {
      item = await dummyGetById(itemId);
    } else {
      item = catalog.find((p) => p.id === itemId);
    }
    if (!item) return res.status(404).json({ error: 'Item not found' });
    item = applyImage(item);
    const orderId = 'ORD-' + Math.random().toString(36).slice(2, 8).toUpperCase();
    const total = +(item.price * qty).toFixed(2);
    const orders = loadOrders();
    const record = { orderId, item: { ...item }, quantity: qty, total, createdAt: new Date().toISOString() };
    orders.push(record);
    saveOrders(orders);
    res.json(record);
  });

  app.get('/api/status', (_req, res) => {
    res.json({ backend: useBedrock ? 'bedrock' : 'mock' });
  });

  // Admin: reload catalog from disk (demo only)
  app.post('/api/admin/reload-catalog', (_req, res) => {
    catalog = loadCatalog();
    res.json({ ok: true, count: catalog.length });
  });

  app.post('/api/chat', async (req, res) => {
    const { prompt, clientId } = req.body ?? {};
    if (!prompt) return res.status(400).json({ error: 'Missing prompt' });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    try {
      // Simple rule-based tool use for demo: search and order
      const lower = prompt.toLowerCase();
      const streamWords = async (text, delay = 5) => {
        for (const t of text.split(' ')) {
          res.write(`data: ${t} \n\n`);
          // eslint-disable-next-line no-await-in-loop
          await new Promise((r) => setTimeout(r, delay));
        }
      };
      const finish = () => {
        res.write('event: done\n');
        res.write('data: end\n\n');
        res.end();
      };

      const doSearch = async (q) => {
        await streamWords(`Searching catalog for "${q}"...`);
        const groups = makeGroups(q);
        let results = usePublicCatalog
          ? (await dummySearch(q)).filter((it) => {
              const hay = [it.title, it.id].join(' ').toLowerCase();
              return groups.length === 0 || groups.every((g) => g.some((t) => hay.includes(t)));
            })
          : (q ? catalog.filter((p) => matchesGroups(p, groups)) : catalog.slice(0, 5));
        if (!results.length) {
          const rawTokens = String(q).toLowerCase().split(/\s+/).filter(Boolean);
          results = usePublicCatalog
            ? (await dummySearch(q)).filter((it) => {
                const hay = [it.title, it.id].join(' ').toLowerCase();
                return rawTokens.every((t) => nearIncludes(hay, t));
              })
            : catalog.filter((p) => matchesFuzzy(p, rawTokens));
        }
        if (!results.length) {
          await streamWords(' No results found.');
          return finish();
        }
        // emit pretty catalog card with up to 6 items
        res.write('event: catalog\n');
        res.write(`data: ${JSON.stringify({ items: results.slice(0, 6).map(applyImage) })} \n\n`);
        await streamWords("\nSay 'buy <ID>' or click Buy to place an order.", 5);
        return finish();
      };

      const parseQuantity = (text) => {
        const qtyMatch = text.match(/(?:qty|quantity|x)\s*(\d+)/i) || text.match(/\b(\d+)\b/);
        const q = qtyMatch ? parseInt(qtyMatch[1], 10) : 1;
        return Math.max(1, isNaN(q) ? 1 : q);
      };

      const doBuy = async (idOrQuery, fullText) => {
        const query = (idOrQuery || '').toString();
        const text = (fullText || '').toString();
        const qty = parseQuantity(text);
        const idMatch = (query || text).match(/[A-Za-z]\d{3,}/i);
        const maybeId = idMatch ? idMatch[0].toUpperCase() : null;
        let exact = null;
        if (usePublicCatalog) {
          if (maybeId) {
            const got = await dummyGetById(maybeId);
            if (got) exact = got;
          }
        } else {
          if (maybeId) exact = catalog.find((p) => p.id.toLowerCase() === maybeId.toLowerCase());
        }
        if (exact) {
          pendingOrders.set(clientId || 'default', { item: exact, quantity: qty });
          const est = +(exact.price * qty).toFixed(2);
          res.write('event: catalog\n');
          res.write(`data: ${JSON.stringify({ items: [applyImage(exact)] })} \n\n`);
          await streamWords(`I can order ${exact.title} (${exact.id}) — Qty ${qty} — Estimated $${est}.\nType 'confirm' to proceed or 'cancel' to abort.`);
          return finish();
        }

        // Fuzzy search by cleaned text (strip qty tokens, numbers, and punctuation)
        const cleaned = query
          .toLowerCase()
          .replace(/(?:qty|quantity|x)\s*\d+/gi, ' ')
          .replace(/\b\d+\b/g, ' ')
          .replace(/[^a-z0-9\s-]+/gi, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        const groups2 = makeGroups(cleaned);
        let candidates = usePublicCatalog
          ? (await dummySearch(cleaned)).filter((it) => {
              const hay = [it.title, it.id].join(' ').toLowerCase();
              return groups2.length === 0 || groups2.every((g) => g.some((t) => hay.includes(t)));
            })
          : catalog.filter((p) => matchesGroups(p, groups2));
        if (candidates.length === 0) {
          const rawTokens = String(cleaned).toLowerCase().split(/\s+/).filter(Boolean);
          candidates = usePublicCatalog
            ? (await dummySearch(cleaned)).filter((it) => {
                const hay = [it.title, it.id].join(' ').toLowerCase();
                return rawTokens.every((t) => nearIncludes(hay, t));
              })
            : catalog.filter((p) => matchesFuzzy(p, rawTokens));
        }
        if (candidates.length === 0) {
          await streamWords(`Couldn't find a product matching "${idOrQuery}".`);
          return finish();
        }
        if (candidates.length > 1) {
          res.write('event: catalog\n');
          res.write(`data: ${JSON.stringify({ items: candidates.slice(0, 6).map(applyImage) })} \n\n`);
          await streamWords(`Found ${candidates.length} products. Click Buy on a card or say 'buy <ID>'.`);
          return finish();
        }
        const item = candidates[0];
        pendingOrders.set(clientId || 'default', { item, quantity: qty });
        const est = +(item.price * qty).toFixed(2);
        res.write('event: catalog\n');
        res.write(`data: ${JSON.stringify({ items: [applyImage(item)] })} \n\n`);
        await streamWords(`I can order ${item.title} (${item.id}) — Qty ${qty} — Estimated $${est}.\nType 'confirm' to proceed or 'cancel' to abort.`);
        return finish();
      };

      const doConfirm = async () => {
        const key = clientId || 'default';
        const pending = pendingOrders.get(key);
        if (!pending) {
          await streamWords('No pending order to confirm.');
          return finish();
        }
        const { item, quantity } = pending;
        const orderId = 'ORD-' + Math.random().toString(36).slice(2, 8).toUpperCase();
        const total = +(item.price * quantity).toFixed(2);
        pendingOrders.delete(key);
        await streamWords(`Order placed: ${orderId}. Item ${item.id} — ${item.title}. Qty ${quantity}. Total $${total}.`);
        // emit a structured event for UI cards
        res.write('event: order\n');
        res.write(`data: ${JSON.stringify({ orderId, item, quantity, total })} \n\n`);
        return finish();
      };

      const doCancel = async () => {
        const key = clientId || 'default';
        if (pendingOrders.has(key)) pendingOrders.delete(key);
        await streamWords('Canceled the pending action.');
        return finish();
      };

      // If there's a pending order and user supplies just a quantity like "5" or "5 of them",
      // treat it as an update to the quantity and re-prompt for confirmation.
      {
        const key = clientId || 'default';
        const pending = pendingOrders.get(key);
        if (pending) {
          const qtyWord = prompt.match(/(?:qty|quantity|x)\s*(\d+)/i);
          const bareQty = prompt.match(/^\s*(\d+)\s*(?:x|units?|pcs|pieces|of\s+(?:them|it))?\s*$/i);
          const n = qtyWord?.[1] || bareQty?.[1];
          if (n) {
            const q = Math.max(1, parseInt(n, 10) || 1);
            const updated = { ...pending, quantity: q };
            pendingOrders.set(key, updated);
            const est = +(updated.item.price * q).toFixed(2);
            await streamWords(`Updated quantity to ${q} for ${updated.item.title} (${updated.item.id}) — Estimated $${est}. Type 'confirm' to proceed or 'cancel' to abort.`);
            return finish();
          }
        }
      }

      // intent: search
      if (/(\bsearch\b|\bfind\b|look for)/i.test(lower)) {
        const m = prompt.match(/(?:search|find|look for)\s+(.+)/i);
        const q = (m?.[1] || prompt).trim();
        return await doSearch(q);
      }
      // intent: buy/order
      if (/(\bbuy\b|\border\b)/i.test(lower)) {
          const idMatch2 = prompt.match(/([A-Za-z]\d{3,})/);
          if (idMatch2) {
            return await doBuy(idMatch2[1], prompt);
          }
          const m = prompt.match(/(?:buy|order)\s+(.+)/i);
          const q = (m?.[1] || '').trim();
          if (q) return await doBuy(q, prompt);
      }

      // confirmations
      if (/(^|\b)(confirm|yes)($|\b)/i.test(lower)) {
        return await doConfirm();
      }
      if (/(^|\b)(cancel|no)($|\b)/i.test(lower)) {
        return await doCancel();
      }

      if (useBedrock) {
        const modelId = process.env.BEDROCK_MODEL_ID;
        const input = {
          anthropic_version: 'bedrock-2023-05-31',
          messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
          max_tokens: 512,
          temperature: 0.7,
          stream: true,
        };
        const command = new InvokeModelWithResponseStreamCommand({
          modelId,
          contentType: 'application/json',
          accept: 'application/json',
          body: JSON.stringify(input),
        });
        const resp = await bedrock.send(command);
        for await (const event of resp.body) {
          const chunk = event.chunk?.bytes ? Buffer.from(event.chunk.bytes).toString('utf8') : null;
          if (!chunk) continue;
          try {
            const data = JSON.parse(chunk);
            if (data.type === 'content_block_delta' && data.delta?.text) {
              res.write(`data: ${data.delta.text} \n\n`);
            }
          } catch {}
        }
        res.write('event: done\n');
        res.write('data: end\n\n');
        res.end();
        return;
      }

      // Fallback mock stream
      const text = `Streaming SSE response to: "${prompt}" with incremental tokens.`;
      const tokens = text.split(' ');
      for (const t of tokens) {
        res.write(`data: ${t} \n\n`);
        await new Promise((r) => setTimeout(r, 5));
      }
      res.write('event: done\n');
      res.write('data: end\n\n');
      res.end();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('SSE error', err);
      res.write('event: error\n');
      res.write(`data: ${JSON.stringify({ message: 'stream error' })}\n\n`);
      res.end();
    }
  });

  return app;
}
