import { describe, expect, it } from 'vitest';
import {
  emptyModelsHint,
  harnessLoginStatus,
  loginCommandForProvider
} from './harness-login.js';
import type { ThreadModelCatalogSnapshot } from './thread-model-catalog.js';

function catalog(
  overrides: Partial<ThreadModelCatalogSnapshot> = {}
): ThreadModelCatalogSnapshot {
  return {
    providers: [],
    byProvider: {},
    inflight: new Set(),
    ...overrides
  };
}

describe('harness login status', () => {
  it('only overlays Cursor and Codex when the CLI is installed', () => {
    expect(loginCommandForProvider('acp-cursor')).toBe('cursor-agent login');
    expect(loginCommandForProvider('codex')).toBe('codex login');
    expect(loginCommandForProvider('claude-code')).toBeNull();
    expect(harnessLoginStatus('claude', catalog(), true)).toBeNull();
    expect(harnessLoginStatus('cursor', catalog(), false)).toBeNull();
  });

  it('treats a missing or in-flight catalog as still checking', () => {
    expect(harnessLoginStatus('cursor', catalog(), true)?.state).toBe('checking');
    expect(harnessLoginStatus('codex', catalog({ inflight: new Set(['codex']) }), true)?.state).toBe('checking');
  });

  it('surfaces sign-in required from auth_required and signed in when listing succeeded', () => {
    expect(harnessLoginStatus('cursor', catalog({
      byProvider: { 'acp-cursor': { models: [], selectedOnlyModels: [], modelLoadError: 'auth_required' } }
    }), true)).toEqual({ state: 'sign_in_required', loginCommand: 'cursor-agent login' });
    expect(harnessLoginStatus('codex', catalog({
      byProvider: { codex: { models: [], selectedOnlyModels: [], modelLoadError: null } }
    }), true)?.state).toBe('signed_in');
    expect(harnessLoginStatus('codex', catalog({
      byProvider: { codex: { models: [], selectedOnlyModels: [], modelLoadError: 'timeout' } }
    }), true)?.state).toBe('unverified');
  });

  it('tells the model picker how to recover from a Cursor login miss', () => {
    expect(emptyModelsHint('acp-cursor', 'auth_required')).toBe('Sign in with cursor-agent login');
    expect(emptyModelsHint('codex', 'auth_required')).toBe('Sign in with codex login');
    expect(emptyModelsHint('acp-cursor', null)).toBe('No models available');
  });

  it('asks to verify PI configuration when that catalog is empty', () => {
    expect(emptyModelsHint('pi', null)).toBe('No models available. Verify your PI configuration.');
    expect(emptyModelsHint('pi', undefined)).toBe('No models available. Verify your PI configuration.');
    expect(emptyModelsHint('pi', 'timeout')).toBe('No models available');
    expect(emptyModelsHint('pi', 'failed')).toBe('No models available');
  });
});
