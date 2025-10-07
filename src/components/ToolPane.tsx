import { useEffect, useRef, useState } from 'react';
import { Box, Button, SpaceBetween, Input, Select } from '@cloudscape-design/components';
import CatalogGrid from './CatalogGrid';
import type { CatalogCard } from '../store/chatStore';
import { searchCatalog } from '../lib/commerce';

export function ToolPane() {
  const [q, setQ] = useState('airpods');
  const [items, setItems] = useState<{ id: string; title: string; price: number; image?: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [order] = useState<{ orderId: string; item: { id: string; title: string; price: number }; quantity: number; total: number } | null>(null);
  const [qty, setQty] = useState<number>(1);

  const abortRef = useRef<AbortController | null>(null);
  const onSearch = async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    setError(null);
    try {
      const res = await searchCatalog(q, { signal: ac.signal });
      setItems(res.items);
    } catch (e: any) {
      setItems([]);
      const reason = (e?.name === 'AbortError' || e?.name === 'TimeoutError') ? 'Request timed out. Check your network or try again.' : 'Search failed. Is the backend running on http://localhost:8787?';
      setError(reason);
    } finally {
      setLoading(false);
    }
  };

  // Debounce search when typing
  const debouncedQ = q.trim();
  useEffect(() => {
    if (!debouncedQ) return;
    const id = setTimeout(() => onSearch(), 350);
    return () => clearTimeout(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQ]);

  // Buying is handled inside CatalogGrid cards; we leave the manual order block below for any direct purchase flows

  return (
    <SpaceBetween size="s">
      <SpaceBetween size="xs" direction="horizontal">
  <Input value={q} onChange={({ detail }) => setQ(detail.value)} placeholder="Search catalog" />
  <Button onClick={onSearch} loading={loading}>Search</Button>
      </SpaceBetween>
      <SpaceBetween size="xs" direction="horizontal">
        <Box variant="awsui-key-label">Quantity</Box>
        <Select
          selectedOption={{ value: String(qty), label: String(qty) }}
          onChange={({ detail }) => setQty(parseInt(detail.selectedOption.value || '1', 10) || 1)}
          options={Array.from({ length: 10 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))}
          placeholder="Qty"
        />
      </SpaceBetween>
      {error && (
        <Box color="text-status-error" variant="p">{error}</Box>
      )}
      {items.length > 0 ? (
        <CatalogGrid card={{ type: 'catalog', items } as CatalogCard} readOnly />
      ) : (
        <Box variant="p">No results</Box>
      )}
      {order && (
        <Box variant="p">Order placed: <b>{order.orderId}</b> — {order.item.title} — Qty {order.quantity} — Total ${order.total}</Box>
      )}
    </SpaceBetween>
  );
}
