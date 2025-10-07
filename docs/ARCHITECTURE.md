## Architecture overview

This project is a small agentic shopping demo with a React + Cloudscape frontend, a lightweight Express backend, and a simple streaming (SSE) protocol for incremental assistant output plus structured events for catalog results and orders.

### Components

Key responsibilities:
- AgentChat talks to `/api/chat` and renders `catalog`/`order` events.
- MessageList is virtualized and can scroll to a specific order.
- CatalogGrid lists results with quantity and Buy; posts to `/api/orders`.
- Zustand keeps sessions, messages, quantities, and streaming state.
- Express serves REST + SSE, search (synonyms/fuzzy), and creates orders.

### Typical interaction (text)
1. User types a prompt (e.g., “find airpods”).
2. Frontend streams SSE from `/api/chat` and renders tokens.
3. Server may emit a `catalog` event; UI shows results.
4. User clicks Buy → POST `/api/orders`.
5. UI adds an order card and updates the sidebar.

### State model (Zustand)
- sessions[]: { id, name, messages[], itemQty{} }
- messages[]: { role: 'user'|'assistant', content, card?, createdAt }
- per-session itemQty map: quantity selectors persist per item
- streaming: isStreaming, stopRequested, tokenCount, streamStartMs/streamEndMs
- recovery: streamError, reconnecting { attempt, inProgress, nextDelayMs }
- navigation: pendingItemId (qty sync from text), scrollToOrderId (virtualized scroll target)

### SSE protocol (high level)
- Data tokens: plain `data: <text>` frames, space-separated words
- Structured events:
  - `event: catalog` + `data: { items: CatalogItem[] }`
  - `event: order` + `data: { orderId, item, quantity, total }`
- End of stream: `event: done` + `data: end` then connection closes
- Errors: `event: error` + `data: { message }` (server-side), or client timeout/retry visible in StatusBar

### Performance & UX
- Virtualized chat list (TanStack Virtual) to keep DOM light
- Image lazy-loading with width/height to reduce layout shift
- Client and server search caches (30s TTL), plus client debounce
- SSE retries with exponential backoff and jitter; user-visible reconnect status

### How it works in 30 seconds
1) User types a prompt in the chat UI.
2) Frontend opens one SSE to `/api/chat` and renders streamed tokens.
3) Server may emit a `catalog` event; the UI shows result cards (qty controls persist via Zustand).
4) Clicking Buy posts to `/api/orders`; server writes to `orders.json` and returns an order record.
5) UI removes the catalog card and adds an order card to the chat; the sidebar updates.
6) StatusBar shows token count/elapsed and reconnect attempts during transient network issues.

### At a glance (text-only)
- Frontend: React + Cloudscape; Zustand store; virtualized chat; SSE client.
- Backend: Express; endpoints: `/api/status`, `/api/catalog/search`, `/api/orders`, `/api/chat` (SSE).
- Data: `server/data/catalog.json` and `server/data/orders.json`.
- Events: SSE emits `token`, `catalog`, `order`, `done`, `error`.
