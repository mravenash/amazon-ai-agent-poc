import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type OrderCard = {
  type: 'order';
  orderId: string;
  item: { id: string; title: string; price?: number; image?: string };
  quantity: number;
  total: number;
};

export type CatalogItem = { id: string; title: string; price: number; image?: string };
export type CatalogCard = {
  type: 'catalog';
  items: CatalogItem[];
};

export type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
  card?: OrderCard | CatalogCard;
  createdAt?: string; // ISO string; auto-set when added
};

export type Session = {
  id: string;
  name: string;
  messages: ChatMessage[];
  // per-session, per-item quantity selections
  itemQty?: Record<string, number>;
};

export type ChatState = {
  sessions: Session[];
  currentSessionId: string | null;
  // session ops
  newSession: (name?: string) => string;
  switchSession: (id: string) => void;
  deleteSession: (id: string) => void;
  renameSession: (id: string, name: string) => void;
  // derived
  selectMessages: () => ChatMessage[];
  // messaging
  addMessage: (m: ChatMessage) => void;
  addTokensToLastAssistant: (chunk: string) => void;
  clear: () => void;
  pruneLastCatalogCard: () => void;
  // streaming control
  isStreaming: boolean;
  setStreaming: (v: boolean) => void;
  stopRequested: boolean;
  requestStop: () => void;
  resetStop: () => void;
  // stats
  tokenCount: number;
  streamStartMs: number | null;
  streamEndMs: number | null;
  startStreamStats: () => void;
  endStreamStats: () => void;
  // recovery
  streamError: string | null;
  setStreamError: (msg: string | null) => void;
  reconnecting: { attempt: number; inProgress: boolean; nextDelayMs?: number } | null;
  setReconnecting: (info: { attempt: number; inProgress: boolean; nextDelayMs?: number } | null) => void;
  lastPrompt: string | null;
  setLastPrompt: (p: string | null) => void;
  clientId: string;
  // pending item (for syncing qty from text updates)
  pendingItemId: string | null;
  setPendingItem: (id: string | null) => void;
  // per-item quantity (persisted per session)
  getItemQty: (itemId: string) => number;
  setItemQty: (itemId: string, qty: number) => void;
  // cross-component scroll target (e.g., scroll to an order message)
  scrollToOrderId: string | null;
  setScrollToOrder: (orderId: string | null) => void;
};

function uuid() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch { /* ignore */ }
  // Fallback
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      sessions: [{ id: 'default', name: 'Default', messages: [] }],
      currentSessionId: 'default',
  clientId: Math.random().toString(36).slice(2),
  pendingItemId: null,
  scrollToOrderId: null,

      newSession: (name) => {
        const id = uuid();
        set((s) => ({
          sessions: [...s.sessions, { id, name: name ?? `Session ${s.sessions.length + 1}`, messages: [] }],
          currentSessionId: id,
        }));
        return id;
      },
      switchSession: (id) => set({ currentSessionId: id }),
      deleteSession: (id) =>
        set((s) => {
          const remaining = s.sessions.filter((x) => x.id !== id);
          return {
            sessions: remaining.length ? remaining : [{ id: 'default', name: 'Default', messages: [] }],
            currentSessionId:
              s.currentSessionId === id ? (remaining[0]?.id ?? 'default') : s.currentSessionId,
          };
        }),
      renameSession: (id, name) =>
        set((s) => ({
          sessions: s.sessions.map((sess) => (sess.id === id ? { ...sess, name } : sess)),
        })),

      selectMessages: () => {
        const s = get();
        const session = s.sessions.find((x) => x.id === s.currentSessionId);
        return session ? session.messages : [];
      },

      addMessage: (m) =>
        set((s) => ({
          sessions: s.sessions.map((sess) =>
            sess.id === s.currentSessionId
              ? { ...sess, messages: [...sess.messages, { createdAt: new Date().toISOString(), ...m }] }
              : sess
          ),
        })),

      addTokensToLastAssistant: (chunk) =>
        set((s) => {
          const sessions = s.sessions.map((sess) => {
            if (sess.id !== s.currentSessionId) return sess;
            const idx = [...sess.messages].reverse().findIndex((m) => m.role === 'assistant');
            if (idx === -1) return sess;
            const realIdx = sess.messages.length - 1 - idx;
            const updatedMsgs = sess.messages.map((m, i) =>
              i === realIdx ? { ...m, content: m.content + chunk } : m
            );
            return { ...sess, messages: updatedMsgs };
          });
          const added = chunk.trim().length ? chunk.trim().split(/\s+/).length : 0;
          return { sessions, tokenCount: s.tokenCount + added };
        }),

      pruneLastCatalogCard: () =>
        set((s) => {
          const sessions = s.sessions.map((sess) => {
            if (sess.id !== s.currentSessionId) return sess;
            const revIdx = [...sess.messages].reverse().findIndex((m) => m.card?.type === 'catalog');
            if (revIdx === -1) return sess;
            const realIdx = sess.messages.length - 1 - revIdx;
            const nextMessages = sess.messages.filter((_, i) => i !== realIdx);
            return { ...sess, messages: nextMessages };
          });
          return { sessions };
        }),

      clear: () =>
        set((s) => ({
          sessions: s.sessions.map((sess) =>
            sess.id === s.currentSessionId ? { ...sess, messages: [] } : sess
          ),
          tokenCount: 0,
          streamStartMs: null,
          streamEndMs: null,
          pendingItemId: null,
        })),

      isStreaming: false,
      setStreaming: (v) => set({ isStreaming: v }),
      stopRequested: false,
      requestStop: () => set({ stopRequested: true }),
      resetStop: () => set({ stopRequested: false }),

      tokenCount: 0,
      streamStartMs: null,
      streamEndMs: null,
      startStreamStats: () => set({ tokenCount: 0, streamStartMs: Date.now(), streamEndMs: null }),
      endStreamStats: () => set({ streamEndMs: Date.now() }),
  streamError: null,
  setStreamError: (msg) => set({ streamError: msg }),
  reconnecting: null,
  setReconnecting: (info) => set({ reconnecting: info }),
  lastPrompt: null,
  setLastPrompt: (p) => set({ lastPrompt: p }),

  setPendingItem: (id) => set({ pendingItemId: id }),

  setScrollToOrder: (orderId) => set({ scrollToOrderId: orderId }),

      // qty helpers
      getItemQty: (itemId) => {
        const s = get();
        const sess = s.sessions.find((x) => x.id === s.currentSessionId);
        return sess?.itemQty?.[itemId] ?? 1;
      },
      setItemQty: (itemId, qty) =>
        set((s) => ({
          sessions: s.sessions.map((sess) => {
            if (sess.id !== s.currentSessionId) return sess;
            const nextQty = Math.max(1, Number.isFinite(qty) ? qty : 1);
            return { ...sess, itemQty: { ...(sess.itemQty || {}), [itemId]: nextQty } };
          }),
        })),
    }),
    {
      name: 'chat-store',
  partialize: (state) => ({ sessions: state.sessions, currentSessionId: state.currentSessionId, clientId: state.clientId }),
      storage: createJSONStorage(() => localStorage),
    }
  )
);
