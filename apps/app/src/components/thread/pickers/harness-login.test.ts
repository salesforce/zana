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
  it('overlays Cursor, Codex, Pi, and OpenCode when the CLI is installed', () => {
    expect(loginCommandForProvider('acp-cursor')).toBe('cursor-agent login');
    expect(loginCommandForProvider('codex')).toBe('codex login');
    expect(loginCommandForProvider('pi')).toBe('pi');
    expect(loginCommandForProvider('acp-opencode')).toBe('opencode auth login');
    expect(loginCommandForProvider('opencode')).toBe('opencode auth login');
    expect(loginCommandForProvider('acp-grok')).toBe('grok login');
    expect(loginCommandForProvider('grok')).toBe('grok login');
    expect(loginCommandForProvider('claude-code')).toBeNull();
    expect(harnessLoginStatus('claude', catalog(), true)).toBeNull();
    expect(harnessLoginStatus('cursor', catalog(), false)).toBeNull();
    expect(harnessLoginStatus('pi', catalog(), false)).toBeNull();
    expect(harnessLoginStatus('opencode', catalog(), false)).toBeNull();
    expect(harnessLoginStatus('grok', catalog(), false)).toBeNull();
  });

  it('treats a missing or in-flight catalog as still checking', () => {
    expect(harnessLoginStatus('cursor', catalog(), true)?.state).toBe('checking');
    expect(harnessLoginStatus('codex', catalog({ inflight: new Set(['codex']) }), true)?.state).toBe('checking');
    expect(harnessLoginStatus('pi', catalog(), true)?.state).toBe('checking');
    expect(harnessLoginStatus('opencode', catalog(), true)?.state).toBe('checking');
    expect(harnessLoginStatus('grok', catalog(), true)?.state).toBe('checking');
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

  it('treats an empty Pi catalog as sign-in required, not signed in', () => {
    expect(harnessLoginStatus('pi', catalog({
      byProvider: { pi: { models: [], selectedOnlyModels: [], modelLoadError: null } }
    }), true)).toEqual({ state: 'sign_in_required', loginCommand: 'pi' });
    expect(harnessLoginStatus('pi', catalog({
      byProvider: {
        pi: {
          models: [{
            id: 'openai/gpt-5.2',
            model: 'openai/gpt-5.2',
            displayName: 'GPT-5.2',
            description: '',
            supportedReasoningEfforts: [],
            defaultReasoningEffort: 'medium',
            isDefault: true
          }],
          selectedOnlyModels: [],
          modelLoadError: null
        }
      }
    }), true)?.state).toBe('signed_in');
    expect(harnessLoginStatus('pi', catalog({
      byProvider: { pi: { models: [], selectedOnlyModels: [], modelLoadError: 'timeout' } }
    }), true)?.state).toBe('unverified');
  });

  it('does not treat an empty OpenCode catalog as signed in', () => {
    expect(harnessLoginStatus('opencode', catalog({
      byProvider: { 'acp-opencode': { models: [], selectedOnlyModels: [], modelLoadError: 'auth_required' } }
    }), true)).toEqual({ state: 'sign_in_required', loginCommand: 'opencode auth login' });
    expect(harnessLoginStatus('opencode', catalog({
      byProvider: { 'acp-opencode': { models: [], selectedOnlyModels: [], modelLoadError: null } }
    }), true)?.state).toBe('unverified');
    expect(harnessLoginStatus('opencode', catalog({
      byProvider: { 'acp-opencode': { models: [], selectedOnlyModels: [], modelLoadError: 'timeout' } }
    }), true)?.state).toBe('unverified');
    expect(harnessLoginStatus('opencode', catalog({
      byProvider: {
        'acp-opencode': {
          models: [{
            id: 'default',
            model: 'default',
            displayName: 'Agent default',
            description: '',
            supportedReasoningEfforts: [],
            defaultReasoningEffort: 'medium',
            isDefault: true
          }],
          selectedOnlyModels: [],
          modelLoadError: null
        }
      }
    }), true)?.state).toBe('signed_in');
  });

  it('does not treat an empty Grok catalog as signed in', () => {
    expect(harnessLoginStatus('grok', catalog({
      byProvider: { 'acp-grok': { models: [], selectedOnlyModels: [], modelLoadError: 'auth_required' } }
    }), true)).toEqual({ state: 'sign_in_required', loginCommand: 'grok login' });
    expect(harnessLoginStatus('grok', catalog({
      byProvider: { 'acp-grok': { models: [], selectedOnlyModels: [], modelLoadError: null } }
    }), true)?.state).toBe('unverified');
  });

  it('tells the model picker how to recover from a Cursor login miss', () => {
    expect(emptyModelsHint('acp-cursor', 'auth_required')).toBe('Sign in with cursor-agent login');
    expect(emptyModelsHint('codex', 'auth_required')).toBe('Sign in with codex login');
    expect(emptyModelsHint('acp-opencode', 'auth_required')).toBe('Sign in with opencode auth login');
    expect(emptyModelsHint('acp-grok', 'auth_required')).toBe('Sign in with grok login');
    expect(emptyModelsHint('acp-cursor', null)).toBe('No models available');
  });

  it('asks to sign in with pi when that catalog is empty', () => {
    expect(emptyModelsHint('pi', null)).toBe('Sign in with pi');
    expect(emptyModelsHint('pi', undefined)).toBe('Sign in with pi');
    expect(emptyModelsHint('pi', 'timeout')).toBe('No models available');
    expect(emptyModelsHint('pi', 'failed')).toBe('No models available');
    expect(emptyModelsHint('pi', 'auth_required')).toBe('Sign in with pi');
  });
});
