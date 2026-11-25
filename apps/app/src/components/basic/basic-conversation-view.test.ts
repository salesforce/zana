import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BASIC_CONVERSATION_VIEW_KEY, DEFAULT_BASIC_CONVERSATION_VIEW, isDefaultBasicConversationView,
  normalizeBasicConversationView, windowCutoff
} from './basic-conversation-view.js';

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe('Basic conversation view options', () => {
  it('normalizes unknown or partial values to defaults', () => {
    expect(normalizeBasicConversationView(null)).toEqual(DEFAULT_BASIC_CONVERSATION_VIEW);
    expect(normalizeBasicConversationView({ sort: 'title', status: 'nope', window: 'week', automations: 'yes' }))
      .toEqual({ sort: 'title', status: 'active', window: 'week', automations: true });
    expect(normalizeBasicConversationView({ status: 'all', automations: false })).toMatchObject({ status: 'all', automations: false });
  });

  it('computes window cutoffs and detects the default view', () => {
    expect(windowCutoff('all', 1e9)).toBeNull();
    expect(windowCutoff('day', 1e9)).toBe(1e9 - 86_400_000);
    expect(windowCutoff('week', 1e9)).toBe(1e9 - 7 * 86_400_000);
    expect(windowCutoff('month', 1e9)).toBe(1e9 - 30 * 86_400_000);
    expect(isDefaultBasicConversationView(DEFAULT_BASIC_CONVERSATION_VIEW)).toBe(true);
    expect(isDefaultBasicConversationView({ ...DEFAULT_BASIC_CONVERSATION_VIEW, automations: false })).toBe(false);
  });

  it('loads and persists the choice in local storage, tolerating broken storage', async () => {
    const store = new Map<string, string>([[BASIC_CONVERSATION_VIEW_KEY, JSON.stringify({ sort: 'created' })]]);
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } });
    const { useBasicConversationView } = await import('./basic-conversation-view.js');
    expect(useBasicConversationView.getState().view.sort).toBe('created');
    useBasicConversationView.getState().update({ status: 'archived' });
    expect(JSON.parse(store.get(BASIC_CONVERSATION_VIEW_KEY)!)).toMatchObject({ sort: 'created', status: 'archived' });

    vi.resetModules();
    vi.stubGlobal('localStorage', { getItem: () => '{bad', setItem: () => { throw new Error('quota'); } });
    const fresh = await import('./basic-conversation-view.js');
    expect(fresh.useBasicConversationView.getState().view).toEqual(DEFAULT_BASIC_CONVERSATION_VIEW);
    fresh.useBasicConversationView.getState().update({ window: 'day' });
    expect(fresh.useBasicConversationView.getState().view.window).toBe('day');
  });
});
