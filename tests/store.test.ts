import { describe, it, expect, beforeEach } from 'vitest';
import { useChatStore } from '../src/store/chatStore';
import type { ChatState } from '../src/store/chatStore';

// simple localStorage mock for zustand persist
const mem = new Map<string, string>();
// Node test environment doesn't provide DOM Storage; we provide a minimal mock
global.localStorage = ({
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => void mem.clear(),
  key: (i: number) => Array.from(mem.keys())[i] ?? null,
  length: 0,
}) as unknown as Storage;

beforeEach(() => {
  mem.clear();
  useChatStore.setState({
    sessions: [{ id: 'default', name: 'Default', messages: [] }],
    currentSessionId: 'default',
    isStreaming: false,
    stopRequested: false,
    tokenCount: 0,
    streamStartMs: null,
    streamEndMs: null,
    streamError: null,
    lastPrompt: null,
    clientId: 'test',
  } as Partial<ChatState>);
});

describe('chatStore', () => {
  it('adds messages and appends assistant tokens', () => {
    const s = useChatStore.getState();
    s.addMessage({ role: 'user', content: 'hi' });
    s.addMessage({ role: 'assistant', content: '' });
    s.addTokensToLastAssistant('hello ');
    const msgs = useChatStore.getState().selectMessages();
    expect(msgs.at(-1)?.content).toContain('hello');
  });

  it('session ops work', () => {
    const id = useChatStore.getState().newSession('Demo');
    expect(useChatStore.getState().currentSessionId).toBe(id);
    useChatStore.getState().renameSession(id, 'Renamed');
    const sess = useChatStore.getState().sessions.find((x) => x.id === id)!;
    expect(sess.name).toBe('Renamed');
    useChatStore.getState().deleteSession(id);
    expect(useChatStore.getState().currentSessionId).toBe('default');
  });
});
