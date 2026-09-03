import { describe, expect, it, beforeEach } from 'vitest';
import {
  __clearComposerSelectionForTest,
  defaultOfferedComposerModel,
  parseComposerSelectionPreference,
  pickOfferedComposerModel,
  preferredComposerModel,
  readComposerSelectionPreference,
  rememberComposerSelection,
  rememberedProviderId,
  rememberedSelectionFor
} from './composer-selection-preference.js';

function installLocalStorage(): void {
  const store = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => { store.clear(); },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size; }
  } as Storage;
}

describe('composer selection preference', () => {
  beforeEach(() => {
    installLocalStorage();
    __clearComposerSelectionForTest();
  });

  it('round-trips the last selected model per provider', () => {
    rememberComposerSelection({
      providerId: 'claude-code',
      model: 'claude-sonnet-5',
      reasoningLevel: 'high'
    });
    expect(rememberedProviderId()).toBe('claude-code');
    expect(rememberedSelectionFor('claude-code')).toEqual({
      model: 'claude-sonnet-5',
      reasoningLevel: 'high'
    });
  });

  it('keeps each provider\'s last pick when the harness changes', () => {
    rememberComposerSelection({
      providerId: 'claude-code',
      model: 'claude-sonnet-5',
      reasoningLevel: 'high'
    });
    rememberComposerSelection({
      providerId: 'codex',
      model: 'gpt-5.5',
      reasoningLevel: 'medium'
    });
    expect(rememberedProviderId()).toBe('codex');
    expect(rememberedSelectionFor('claude-code')?.model).toBe('claude-sonnet-5');
    expect(rememberedSelectionFor('codex')?.model).toBe('gpt-5.5');
  });

  it('ignores blank ids and corrupt storage', () => {
    rememberComposerSelection({ providerId: ' ', model: 'claude-sonnet-5' });
    expect(readComposerSelectionPreference()).toEqual({ byProvider: {} });
    expect(parseComposerSelectionPreference('{')).toEqual({ byProvider: {} });
    expect(parseComposerSelectionPreference(JSON.stringify({
      providerId: 3,
      byProvider: { 'claude-code': { model: false } }
    }))).toEqual({ byProvider: {} });
  });

  it('fails soft when localStorage is missing', () => {
    delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
    expect(() => rememberComposerSelection({
      providerId: 'claude-code',
      model: 'claude-sonnet-5'
    })).not.toThrow();
    expect(readComposerSelectionPreference()).toEqual({ byProvider: {} });
  });
});

describe('preferredComposerModel', () => {
  const offered = ['claude-opus-5[1m]', 'claude-sonnet-5'];

  it('keeps a remembered new-thread model instead of the catalog default', () => {
    expect(preferredComposerModel({
      rememberedModel: 'claude-sonnet-5',
      currentModel: 'claude-opus-5[1m]',
      persistRemembered: true,
      offeredModels: offered,
      fallbackModel: 'claude-opus-5[1m]',
      loading: false
    })).toBe('claude-sonnet-5');
  });

  it('uses the remembered model while the catalog is still loading', () => {
    expect(preferredComposerModel({
      rememberedModel: 'claude-sonnet-5',
      currentModel: 'claude-opus-5[1m]',
      persistRemembered: true,
      offeredModels: [],
      fallbackModel: 'claude-opus-5[1m]',
      loading: true
    })).toBe('claude-sonnet-5');
  });

  it('does not apply the cache on an existing thread', () => {
    expect(preferredComposerModel({
      rememberedModel: 'claude-sonnet-5',
      currentModel: 'claude-opus-5[1m]',
      persistRemembered: false,
      offeredModels: offered,
      fallbackModel: 'claude-opus-5[1m]',
      loading: false
    })).toBe('claude-opus-5[1m]');
  });

  it('falls back when a remembered model is no longer offered', () => {
    expect(preferredComposerModel({
      rememberedModel: 'retired-model',
      currentModel: '',
      persistRemembered: true,
      offeredModels: offered,
      fallbackModel: 'claude-opus-5[1m]',
      loading: false
    })).toBe('claude-opus-5[1m]');
  });

  it('stays empty after load when the catalog has no models', () => {
    expect(preferredComposerModel({
      rememberedModel: 'retired-model',
      currentModel: '',
      persistRemembered: true,
      offeredModels: [],
      fallbackModel: 'claude-opus-5[1m]',
      loading: false
    })).toBe('');
  });
});

describe('pickOfferedComposerModel', () => {
  const offered = ['claude-opus-5[1m]', 'claude-sonnet-5'];

  it('keeps the remembered model when it is still offered', () => {
    expect(pickOfferedComposerModel({
      rememberedModel: 'claude-sonnet-5',
      currentModel: '',
      offeredModels: offered,
      fallbackModel: 'claude-opus-5[1m]'
    })).toBe('claude-sonnet-5');
  });

  it('keeps the current model when remembered is missing or retired', () => {
    expect(pickOfferedComposerModel({
      rememberedModel: 'retired-model',
      currentModel: 'claude-sonnet-5',
      offeredModels: offered,
      fallbackModel: 'claude-opus-5[1m]'
    })).toBe('claude-sonnet-5');
  });

  it('picks the catalog default after load when nothing is selected', () => {
    expect(pickOfferedComposerModel({
      currentModel: '',
      offeredModels: offered,
      fallbackModel: 'claude-sonnet-5'
    })).toBe('claude-sonnet-5');
  });

  it('picks the first offered model when there is no default or prior pick', () => {
    expect(pickOfferedComposerModel({
      currentModel: '',
      offeredModels: offered
    })).toBe('claude-opus-5[1m]');
  });

  it('never returns empty while any model is offered', () => {
    expect(pickOfferedComposerModel({
      currentModel: '',
      offeredModels: ['gpt-5.5']
    })).toBe('gpt-5.5');
    expect(pickOfferedComposerModel({
      currentModel: '',
      offeredModels: []
    })).toBe('');
  });
});

describe('defaultOfferedComposerModel', () => {
  it('prefers isDefault across the primary list and more-models', () => {
    expect(defaultOfferedComposerModel(
      [{ model: 'a', isDefault: false }],
      [{ model: 'b', isDefault: true }]
    )).toEqual({ model: 'b', isDefault: true });
  });

  it('falls through to the first offered row when nothing is marked default', () => {
    type Row = { model: string; isDefault?: boolean };
    expect(defaultOfferedComposerModel<Row>(
      [],
      [{ model: 'pinned' }, { model: 'other' }]
    )).toEqual({ model: 'pinned' });
    expect(defaultOfferedComposerModel([])).toBeUndefined();
  });
});
