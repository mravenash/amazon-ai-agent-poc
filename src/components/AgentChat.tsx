import { useState } from 'react';
import { Button, SpaceBetween, Textarea, Select, Box, Input, Flashbar, Spinner } from '@cloudscape-design/components';
import { useChatStore } from '../store/chatStore';
import { MessageList } from './MessageList';
import { sseChatStreamWithRetry } from '../lib/sse';
import { debug } from '../lib/log';

export function AgentChat() {
  const store = useChatStore();
  const messages = store.selectMessages();
  const { addMessage, addTokensToLastAssistant, isStreaming, setStreaming, requestStop, resetStop } = store;
  const [input, setInput] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [sessionName, setSessionName] = useState('');
  const lastAssistant = messages
    .slice()
    .reverse()
    .find((m) => m.role === 'assistant')?.content ?? '';

  const onSend = async () => {
    const text = input.trim();
    if (!text) return;
    setInput('');
  store.setLastPrompt(text);
    addMessage({ role: 'user', content: text });

    // If user typed a quantity update, sync it to the pending item dropdown before streaming
  try {
      const qtyWord = text.match(/(?:qty|quantity|x)\s*(\d+)/i);
      const bareQty = text.match(/^\s*(\d+)\s*(?:x|units?|pcs|pieces)?\s*$/i);
      const n = qtyWord?.[1] || bareQty?.[1];
      const pid = useChatStore.getState().pendingItemId;
      if (pid && n) {
        const q = Math.max(1, parseInt(n, 10) || 1);
        useChatStore.getState().setItemQty(pid, q);
      }
  } catch (e) { debug('qty-parse failed', e); }

    // helper: scroll chat container to bottom
    const scrollToBottom = () => {
      try {
        requestAnimationFrame(() => {
          const container = document.querySelector('.chat-list') as HTMLElement | null;
          if (container) container.scrollTop = container.scrollHeight;
        });
  } catch (e) { debug('scrollToBottom failed', e); }
    };

    // Use SSE backend
    const abort = new AbortController();
    addMessage({ role: 'assistant', content: '' });
    setStreaming(true);
    store.startStreamStats();
    resetStop();
    scrollToBottom();
    try {
      store.setStreamError(null);
      for await (const ev of sseChatStreamWithRetry(text, {
        signal: abort.signal,
        clientId: store.clientId,
        onRetry: ({ attempt, delayMs }) => {
          useChatStore.getState().setReconnecting({ attempt, inProgress: true, nextDelayMs: delayMs });
        },
      })) {
        if (useChatStore.getState().stopRequested) {
          abort.abort();
          break;
        }
        if (ev.type === 'token') {
          addTokensToLastAssistant(ev.data);
          scrollToBottom();
        } else if (ev.type === 'catalog') {
          const { items } = ev.data;
          addTokensToLastAssistant(`\n\nFound ${items.length} item(s).`);
      store.addMessage({ role: 'assistant', content: '', card: { type: 'catalog', items } });
          // Sync requested quantity from prompt to result items (single or multiple)
          try {
            const text = useChatStore.getState().lastPrompt || '';
            const m = text.match(/(?:qty|quantity|x)\s*(\d+)/i);
            if (m && m[1]) {
              const q = Math.max(1, parseInt(m[1], 10) || 1);
              items.forEach((it) => useChatStore.getState().setItemQty(it.id, q));
            }
          } catch (e) { debug('sync qty from lastPrompt failed', e); }
          if (items.length === 1) {
            store.setPendingItem(items[0].id);
          }
          scrollToBottom();
        } else if (ev.type === 'order') {
          const { orderId, item, quantity, total } = ev.data;
          // Remove the last catalog card so it doesn't clutter the view post-confirmation
          store.pruneLastCatalogCard();
          store.setPendingItem(null);
          // Add a text summary for screen readers and logs
          addTokensToLastAssistant(`\n\nOrder confirmed: ${item.title} x${quantity}. Total $${total}. (ID: ${orderId})\n`);
          // Also push a structured card message for nicer UI
          addMessage({ role: 'assistant', content: '', card: { type: 'order', orderId, item, quantity, total } });
          try { window.dispatchEvent(new CustomEvent('orders:updated')); } catch (e) { debug('dispatch orders:updated failed', e); }
          scrollToBottom();
        }
      }
    } catch (e: any) {
      const msg = e?.name === 'AbortError' ? 'Request was canceled.' : 'There was a problem connecting to the assistant. Please check the server and try again.';
      store.setStreamError(msg);
      // Replace the last assistant message content if empty so typing dots don’t linger
      try {
        const last = [...useChatStore.getState().selectMessages()].reverse().find((m) => m.role === 'assistant');
        if (last && !last.content) {
          useChatStore.getState().addTokensToLastAssistant(msg);
        }
  } catch (e) { debug('final scrollToBottom failed', e); }
    } finally {
      setStreaming(false);
      store.endStreamStats();
  useChatStore.getState().setReconnecting(null);
      // After stream completes, ensure we see the last message/card
      scrollToBottom();
      try {
        const msgs = useChatStore.getState().selectMessages();
        const lastAssistant = [...msgs].reverse().find((m) => m.role === 'assistant');
        if (lastAssistant && !lastAssistant.content?.trim()) {
          useChatStore.getState().addTokensToLastAssistant('No response received. Please try again.');
        }
  } catch (e) { debug('ensure last assistant content fallback failed', e); }
    }
  };

  const retryLast = async () => {
    if (!store.lastPrompt) return;
    setInput(store.lastPrompt);
    await onSend();
  };

  const onRegenerate = async () => {
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    if (!lastUser) return;
    setInput(lastUser.content);
    await onSend();
  };

  return (
    <SpaceBetween size="l">
      <MessageList messages={messages} />
      {store.streamError && (
        <Flashbar
          items={[{
            type: 'error',
            content: store.streamError,
            dismissible: true,
            onDismiss: () => store.setStreamError(null),
          }]}
        />
      )}
      <Box variant="awsui-key-label">Status</Box>
      <Box variant="p">Tokens: {store.tokenCount} {store.streamStartMs && store.streamEndMs ? `| Latency: ${store.streamEndMs - store.streamStartMs}ms` : ''}</Box>
  <div className="visually-hidden" aria-live="polite">{lastAssistant}</div>
  <div className="chat-input-sticky">
  <SpaceBetween size="xs">
        <SpaceBetween size="xs" direction="horizontal">
          <Select
            selectedOption={{ value: store.currentSessionId ?? 'default', label: store.sessions.find(s => s.id === store.currentSessionId)?.name ?? 'Default' }}
            onChange={({ detail }) => store.switchSession(detail.selectedOption.value!)}
            options={store.sessions.map((s) => ({ value: s.id, label: s.name }))}
            placeholder="Select session"
          />
          {renaming ? (
            <SpaceBetween size="xs" direction="horizontal">
              <Input
                value={sessionName}
                onChange={({ detail }) => setSessionName(detail.value)}
                placeholder="Session name"
              />
              <Button
                onClick={() => {
                  if (store.currentSessionId) store.renameSession(store.currentSessionId, sessionName.trim() || 'Untitled');
                  setRenaming(false);
                }}
              >Save</Button>
              <Button variant="normal" onClick={() => setRenaming(false)}>Cancel</Button>
            </SpaceBetween>
          ) : (
            <SpaceBetween size="xs" direction="horizontal">
              <Button onClick={() => store.newSession()}>New</Button>
              <Button
                variant="normal"
                onClick={() => {
                  if (store.currentSessionId) {
                    setSessionName(store.sessions.find(s => s.id === store.currentSessionId)?.name ?? '');
                    setRenaming(true);
                  }
                }}
              >Rename</Button>
              <Button
                variant="normal"
                onClick={() => {
                  if (store.currentSessionId) store.deleteSession(store.currentSessionId);
                }}
              >Delete</Button>
            </SpaceBetween>
          )}
        </SpaceBetween>
        <Textarea
          value={input}
          onChange={({ detail }) => setInput(detail.value)}
          placeholder="Ask the agent…"
          rows={3}
          ariaLabel="Message input"
          onKeyDown={({ detail }) => {
            if (detail.key === 'Enter' && !detail.shiftKey) {
              onSend();
            }
          }}
        />
        <div className="chat-actions">
          <Button onClick={() => useChatStore.getState().clear()} disabled={isStreaming}>Clear</Button>
          <div className="chat-actions-right">
            {isStreaming && (
              <>
                <Spinner />
                <Button onClick={requestStop} variant="normal">Stop</Button>
              </>
            )}
            {!isStreaming && (
              <>
                <Button onClick={onRegenerate} variant="normal" disabled={messages.length === 0}>Regenerate</Button>
                <Button onClick={retryLast} variant="normal" disabled={!store.lastPrompt}>Retry</Button>
              </>
            )}
            <Button variant="primary" onClick={onSend} disabled={isStreaming}>Send</Button>
          </div>
        </div>
  </SpaceBetween>
  </div>
    </SpaceBetween>
  );
}
 
