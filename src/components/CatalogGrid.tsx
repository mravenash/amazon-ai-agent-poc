import { debug } from '../lib/log';
import { Box, Button, Cards, SpaceBetween, TextContent, Select } from '@cloudscape-design/components';
import { useState } from 'react';
import type { CatalogCard, CatalogItem, OrderCard } from '../store/chatStore';
import { useChatStore } from '../store/chatStore';

type Props = { card: CatalogCard; readOnly?: boolean };

export function CatalogGrid({ card, readOnly }: Props) {
  const store = useChatStore();
  const [loadingId, setLoadingId] = useState<string | null>(null);
  // use global store to persist qty per session
  const getQty = (id: string) => store.getItemQty(id);
  const setQty = (id: string, v: number) => store.setItemQty(id, v);

  const onBuy = async (id: string, quantity: number) => {
    // Reflect user intent in chat
    const prompt = `buy ${id} qty ${quantity}`;
    store.addMessage({ role: 'user', content: prompt });
    store.setLastPrompt(prompt);
    try {
      setLoadingId(id);
      const resp = await fetch('http://localhost:8787/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId: id, quantity }),
      });
      if (!resp.ok) throw new Error('order failed');
      const data = await resp.json();
      // Remove the listing card to avoid clutter
      store.pruneLastCatalogCard();
      const card: OrderCard = {
        type: 'order',
        orderId: data.orderId,
        item: data.item,
        quantity: data.quantity,
        total: data.total,
      };
      store.addMessage({ role: 'assistant', content: '', card });
      // Scroll to bottom so the order card is visible
      try {
        requestAnimationFrame(() => {
          const container = document.querySelector('.chat-list') as HTMLElement | null;
          if (container) container.scrollTop = container.scrollHeight;
        });
      } catch (e) { debug('catalog buy scrollToBottom failed', e); }
      try { window.dispatchEvent(new CustomEvent('orders:updated')); } catch (e) { debug('dispatch orders:updated failed', e); }
    } catch {
      store.addMessage({ role: 'assistant', content: 'Sorry, I could not place the order right now.' });
    } finally {
      setLoadingId((curr) => (curr === id ? null : curr));
    }
  };

  return (
    <SpaceBetween size="xs">
      <TextContent>
        <h4 className="top-results-title">Top results</h4>
      </TextContent>
      <Cards
        cardDefinition={{
          header: (item: CatalogItem) => (
            <div className="catalog-header">
              <strong className="line-clamp-2">
                {item.title}
              </strong>
              <span className="catalog-subid">
                {item.id}
              </span>
            </div>
          ),
          sections: [
            {
              id: 'media',
              content: (item: CatalogItem) => (
                <img
                  src={item.image || 'https://picsum.photos/seed/placeholder/240/180'}
                  alt={item.title}
                  width={240}
                  height={180}
                  loading="lazy"
                  decoding="async"
                  onError={(e) => {
                    const img = e.currentTarget as HTMLImageElement;
                    img.onerror = null; // prevent loop
                    img.src = 'https://picsum.photos/seed/placeholder/240/180';
                  }}
                  className="catalog-media-img"
                />
              ),
            },
            {
              id: 'price',
              content: (item: CatalogItem) => {
                const unit = typeof item.price === 'number' ? item.price : Number(item.price) || 0;
                const content = () => {
                  if (readOnly) {
                    return <Box variant="h4">${unit.toFixed(2)}</Box>;
                  }
                  const qty = getQty(item.id);
                  const subtotal = unit * qty || 0;
                  return (
                    <SpaceBetween size="xxs">
                      <Box variant="h4">${unit.toFixed(2)}</Box>
                      <Box variant="p" color="text-body-secondary">
                        <span className="subtotal-text">
                          Subtotal: ${subtotal.toFixed(2)} ({qty} × ${unit.toFixed(2)})
                        </span>
                      </Box>
                    </SpaceBetween>
                  );
                };
                return <div className={readOnly ? 'price-min-ro' : 'price-min'}>{content()}</div>;
              },
            },
            // actions area hidden in read-only mode
            ...(!readOnly
              ? [
                  {
                    id: 'actions',
                    content: (item: CatalogItem) => (
                      <div className="actions-min">
                        <SpaceBetween size="xxs">
                          <Select
                            selectedOption={{ value: String(getQty(item.id)), label: String(getQty(item.id)) }}
                            options={Array.from({ length: 10 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))}
                            ariaLabel={`Quantity for ${item.title}`}
                            onChange={({ detail }) => {
                              setQty(item.id, parseInt(detail.selectedOption.value || '1', 10) || 1);
                            }}
                          />
                          <Button
                            variant="primary"
                            loading={loadingId === item.id}
                            onClick={() => onBuy(item.id, getQty(item.id))}
                            ariaLabel={`Buy ${item.title} (${item.id}) quantity ${getQty(item.id)}`}
                          >
                            Buy
                          </Button>
                        </SpaceBetween>
                      </div>
                    ),
                  },
                ]
              : []),
          ],
        }}
        cardsPerRow={[
          { cards: 1 },
          { minWidth: 300, cards: 2 },
          { minWidth: 700, cards: 3 },
          { minWidth: 1000, cards: 4 },
          { minWidth: 1300, cards: 5 },
        ]}
        items={card.items}
        empty={<Box textAlign="center">No items</Box>}
      />
    </SpaceBetween>
  );
}

export default CatalogGrid;
