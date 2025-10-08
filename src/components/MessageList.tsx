import { useEffect, useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
// removed Box; bubbles render without it
import type { ChatMessage } from '../store/chatStore';
import type { OrderCard as OrderCardType } from '../store/chatStore';
import { OrderCard } from './OrderCard';
import CatalogGrid from './CatalogGrid';
import { useChatStore } from '../store/chatStore';
import { debug } from '../lib/log';

type Props = {
  messages: ChatMessage[];
};

export function MessageList({ messages }: Props) {
  const parentRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const scrollToOrderId = useChatStore((s) => s.scrollToOrderId);
  const setScrollToOrder = useChatStore((s) => s.setScrollToOrder);

  const rowVirtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => parentRef.current,
    // Use a larger baseline to reduce layout thrash when cards/images render
    estimateSize: () => 100,
    overscan: 8,
  });

  const items = rowVirtualizer.getVirtualItems();

  // Compute a simple fingerprint of message contents to detect content updates (like streaming tokens)
  const msgFingerprint = useMemo(() => messages.map(m => `${m.role}:${m.content?.length ?? 0}:${m.card ? (m.card as any).type : '-'}`).join('|'), [messages]);

  // Auto-scroll to bottom when messages change and we're already near the bottom
  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (!nearBottom) return;
    // scroll to the last item
    rowVirtualizer.scrollToIndex(messages.length - 1, { align: 'end' });
    // ensure container is scrolled fully after layout
    requestAnimationFrame(() => {
      const el2 = parentRef.current;
      if (el2) el2.scrollTop = el2.scrollHeight;
    });
  }, [msgFingerprint, rowVirtualizer, messages.length]);

  // Keep the inner container's height in sync without JSX inline styles
  useEffect(() => {
    const el = innerRef.current;
    if (el) el.style.height = `${rowVirtualizer.getTotalSize()}px`;
  }, [rowVirtualizer, messages.length, msgFingerprint]);

  // Observe the last rendered row for size changes (e.g., streaming tokens growing)
  useEffect(() => {
    const container = parentRef.current;
    if (!container) return;
    const lastIndex = messages.length - 1;
    if (lastIndex < 0) return;
    const lastEl = container.querySelector(`.virtualizer-item[data-index="${lastIndex}"]`) as HTMLElement | null;
    if (!lastEl) return;
    const ro = new ResizeObserver(() => {
      // re-measure the element to update virtualizer cache
      try { rowVirtualizer.measureElement(lastEl); } catch (e) { debug('measureElement failed', e); }
      // If user is near bottom, keep them pinned to bottom
      const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 40;
      if (nearBottom) {
        rowVirtualizer.scrollToIndex(lastIndex, { align: 'end' });
        requestAnimationFrame(() => {
          container.scrollTop = container.scrollHeight;
        });
      }
    });
    ro.observe(lastEl);
    return () => ro.disconnect();
    // We only need to rebind when the last index element changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, rowVirtualizer]);

  // Handle programmatic scroll to a specific orderId using the virtualizer
  useEffect(() => {
    if (!scrollToOrderId) return;
    const idx = messages.findIndex((m) => m.card?.type === 'order' && (m.card as OrderCardType).orderId === scrollToOrderId);
    if (idx >= 0) {
      rowVirtualizer.scrollToIndex(idx, { align: 'center' });
    }
    // clear the target either way to avoid loops
    setScrollToOrder(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollToOrderId]);

  return (
    <div ref={parentRef} className="chat-list" aria-live="polite" role="log" aria-relevant="additions text">
      <div ref={innerRef} className="virtualizer-inner">
        {items.map((virtualRow) => {
          const m = messages[virtualRow.index];
          return (
            <div
              key={virtualRow.key}
              ref={(el) => {
                if (!el) return;
                rowVirtualizer.measureElement(el);
                el.style.transform = `translateY(${virtualRow.start}px)`;
              }}
              data-index={virtualRow.index}
              className="virtualizer-item"
              id={m.card && m.card.type === 'order' ? `order-${(m.card as OrderCardType).orderId}` : undefined}
            >
              {m.card ? (
                <div>
                  <div className={`bubble-row assistant`}>
                    <div className="bubble-avatar" aria-hidden />
                    <div className="bubble assistant" role="article">
                      {m.card.type === 'order' ? (
                        <OrderCard card={m.card} />
                      ) : m.card.type === 'catalog' ? (
                        <CatalogGrid card={m.card} />
                      ) : null}
                      <div className="bubble-meta">Agent · {m.createdAt ? new Date(m.createdAt).toLocaleTimeString() : ''}</div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className={`bubble-row ${m.role}`}>
                  {m.role === 'assistant' && <div className="bubble-avatar" aria-hidden />}
                  <div className={`bubble ${m.role}`}>
                    <div>{m.content || (m.role === 'assistant' ? (<span className="typing-dots" aria-label="typing"><span /> <span /> <span /></span>) : null)}</div>
                    <div className="bubble-meta">{m.role === 'user' ? 'You' : 'Agent'} · {m.createdAt ? new Date(m.createdAt).toLocaleTimeString() : ''}</div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
