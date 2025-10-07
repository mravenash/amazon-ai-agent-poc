import '@cloudscape-design/global-styles/index.css';
import { applyMode, applyDensity, Mode, Density } from '@cloudscape-design/global-styles';
import '../styles/chat.css';
import { AppLayout, ContentLayout, Header, SpaceBetween, Container, SideNavigation, Button, Spinner, Toggle } from '@cloudscape-design/components';
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { ErrorBoundary } from './ErrorBoundary';
import { useChatStore } from '../store/chatStore';
import { StatusBar } from './StatusBar';
import { ToolPane } from './ToolPane';
import { OrderCard as OrderCardView } from './OrderCard';

const AgentChat = lazy(() => import('./AgentChat').then(m => ({ default: m.AgentChat })));

export default function AppShell() {
  const [reloading, setReloading] = useState(false);
  const store = useChatStore();
  const [orders, setOrders] = useState<Array<{ orderId: string; item: { id: string; title: string; image?: string; price?: number }; quantity: number; total: number; createdAt?: string }>>([]);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const selectedOrder = useMemo(() => orders.find(o => o.orderId === selectedOrderId) || null, [orders, selectedOrderId]);
  const footerRef = useRef<HTMLDivElement | null>(null);
  const [showFooterTools, setShowFooterTools] = useState(false);
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('ui:colorMode');
      if (saved === 'dark') return true;
      if (saved === 'light') return false;
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch { return false; }
  });
  const [compactDensity, setCompactDensity] = useState<boolean>(() => {
    try { return localStorage.getItem('ui:density') === 'compact'; } catch { return false; }
  });
  const [activeNavHref, setActiveNavHref] = useState<string>(`#${store.currentSessionId ?? 'default'}`);
  const [expandedOrderGroups, setExpandedOrderGroups] = useState<Record<string, boolean>>({});

  async function fetchOrders() {
    try {
      const r = await fetch('http://localhost:8787/api/orders');
      if (!r.ok) return;
      const data = await r.json();
      setOrders(Array.isArray(data.orders) ? data.orders.slice().reverse() : []);
  } catch { /* no-op */ }
  }

  useEffect(() => {
    fetchOrders();
  const onUpdated = () => fetchOrders();
    window.addEventListener('orders:updated', onUpdated as EventListener);
    return () => window.removeEventListener('orders:updated', onUpdated as EventListener);
  }, []);

  // Apply color mode and density preferences
  useEffect(() => {
    try {
  applyMode(darkMode ? Mode.Dark : Mode.Light);
      localStorage.setItem('ui:colorMode', darkMode ? 'dark' : 'light');
    } catch { /* no-op */ }
  }, [darkMode]);
  useEffect(() => {
    try {
  applyDensity(compactDensity ? Density.Compact : Density.Comfortable);
      localStorage.setItem('ui:density', compactDensity ? 'compact' : 'comfortable');
    } catch { /* no-op */ }
  }, [compactDensity]);
  // Build collapsible Orders section, grouped by session (reduces sidebar clutter)
  const ordersBySessionGroups = store.sessions
    .map((sess) => {
      const sessOrders = (sess.messages || [])
        .filter((m) => m.card && m.card.type === 'order')
        .map((m) => ({
          orderId: (m.card as any).orderId as string,
          title: (m.card as any).item?.title as string,
        }));
      if (!sessOrders.length) return null;
      return {
        type: 'expandable-link-group' as const,
        text: sess.name,
        href: `#orders:${sess.id}`,
        defaultExpanded: !!expandedOrderGroups[sess.id] || (activeNavHref.startsWith('#order:') && activeNavHref.split(':')[1] === sess.id),
        items: sessOrders.map((oc) => ({
          type: 'link' as const,
          text: `${oc.title} (${oc.orderId})`,
          href: `#order:${sess.id}:${oc.orderId}`,
        })),
      };
    })
    .filter(Boolean) as Array<{ type: 'expandable-link-group'; text: string; href: string; defaultExpanded?: boolean; items: Array<{ type: 'link'; text: string; href: string }> }>;

  const items = [
    {
      type: 'link-group' as const,
      text: 'Sessions',
      href: '#sessions',
      items: store.sessions.map((s) => ({ type: 'link' as const, text: s.name, href: `#${s.id}` })),
    },
    {
      type: 'section' as const,
      text: 'Orders',
      items: ordersBySessionGroups,
    },
  ];

  return (
    <AppLayout
      toolsHide={true}
      navigation={
        <SideNavigation
          activeHref={activeNavHref}
          items={items}
          onFollow={async (e) => {
            e.preventDefault();
            const href = e.detail.href || '';
            if (href.startsWith('#order:')) {
              // href shape: #order:<sessionId>:<orderId>
              const parts = href.split(':');
              const sessId = parts[1];
              const oid = parts[2];
              if (sessId) setExpandedOrderGroups((prev) => ({ ...prev, [sessId]: true }));
              setActiveNavHref(href);
              if (sessId) store.switchSession(sessId);
                // request MessageList to scroll to this order via store (works with virtualization)
                try { requestAnimationFrame(() => useChatStore.getState().setScrollToOrder(oid)); } catch { /* no-op */ }
              // Also show details in footer if desired
              await fetchOrders();
              setSelectedOrderId(oid || null);
              setShowFooterTools(true);
              try {
                requestAnimationFrame(() => footerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }));
              } catch { /* no-op */ }
              return;
            }
            const id = href.slice(1);
            if (id) {
              store.switchSession(id);
              setActiveNavHref(`#${id}`);
            }
          }}
        />
      }
      content={
        <ContentLayout 
          header={
            <Header 
              variant="h1"
              actions={
                <SpaceBetween size="xs" direction="horizontal">
                  <Button onClick={fetchOrders}>Refresh orders</Button>
                  <Button
                    onClick={async () => {
                      try {
                        setReloading(true);
                        await fetch('http://localhost:8787/api/admin/reload-catalog', { method: 'POST' });
                      } finally {
                        setReloading(false);
                      }
                    }}
                    loading={reloading}
                  >
                    Reload catalog
                  </Button>
                </SpaceBetween>
              }
            >
              Applied AI Agent POC
            </Header>
          }
        >
          <SpaceBetween size="l">
            <Container header={<Header>Conversation</Header>}>
              <StatusBar />
              <ErrorBoundary>
                <Suspense
                  fallback={
                    <div className="center-50vh">
                      <Spinner size="large" />
                    </div>
                  }
                >
                  <AgentChat />
                </Suspense>
              </ErrorBoundary>
            </Container>
            {/* Bottom toggles: Dev tools, Dark mode, Density */}
            <div className="footer-tools-toggle" role="toolbar" aria-label="Display options">
              <SpaceBetween size="s" direction="horizontal">
                <Toggle checked={showFooterTools} onChange={({ detail }) => setShowFooterTools(detail.checked)} ariaLabel="Toggle developer tools">
                  Dev tools
                </Toggle>
                <Toggle checked={darkMode} onChange={({ detail }) => setDarkMode(detail.checked)} ariaLabel="Toggle dark mode">
                  Dark mode
                </Toggle>
                <Toggle checked={compactDensity} onChange={({ detail }) => setCompactDensity(detail.checked)} ariaLabel="Toggle compact density">
                  Compact
                </Toggle>
              </SpaceBetween>
            </div>
            <div ref={footerRef} />
            {showFooterTools && (
              <>
                <Container header={<Header>Developer Tools</Header>}>
                  <ToolPane />
                </Container>
                {selectedOrder && (
                  <Container header={<Header>Order details</Header>}>
                    <OrderCardView
                      card={{
                        type: 'order',
                        orderId: selectedOrder.orderId,
                        item: selectedOrder.item,
                        quantity: selectedOrder.quantity,
                        total: selectedOrder.total,
                      }}
                    />
                  </Container>
                )}
              </>
            )}
          </SpaceBetween>
        </ContentLayout>
      }
    />
  );
}
