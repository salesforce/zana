import { describe, expect, it } from 'vitest';
import {
  captureToolPolicyStamp,
  classifyDeclaredToolPolicy,
  createToolPolicyInventoryState,
  persistKnownTrueMonotonically,
  resolveActivatedToolPolicy,
  requiredPolicyPluginIds,
  sameToolPolicyStamp,
  type ToolPolicyInventoryEntry
} from './plugin-tool-policy-state.js';

function entry(over: Partial<ToolPolicyInventoryEntry> = {}): ToolPolicyInventoryEntry {
  return {
    pluginId: 'policy-plugin',
    enabled: true,
    hasServer: true,
    toolPolicy: 'unknown',
    ...over
  };
}

describe('classifyDeclaredToolPolicy', () => {
  it('classifies explicit true as true', () => {
    expect(classifyDeclaredToolPolicy({ declared: true, hasServer: true })).toBe('true');
  });

  it('classifies explicit false as false', () => {
    expect(classifyDeclaredToolPolicy({ declared: false, hasServer: true })).toBe('false');
  });

  it('classifies omitted plus server as unknown', () => {
    expect(classifyDeclaredToolPolicy({ declared: undefined, hasServer: true })).toBe('unknown');
  });

  it('classifies omitted plus no server as false', () => {
    expect(classifyDeclaredToolPolicy({ declared: undefined, hasServer: false })).toBe('false');
  });
});

describe('persistKnownTrueMonotonically', () => {
  it('keeps known true when an enabled install later omits or declares false', () => {
    expect(
      persistKnownTrueMonotonically({ existing: 'true', next: 'unknown', enabled: true })
    ).toBe('true');
    expect(
      persistKnownTrueMonotonically({ existing: 'true', next: 'false', enabled: true })
    ).toBe('true');
  });

  it('allows a later classification when the install is not enabled', () => {
    expect(
      persistKnownTrueMonotonically({ existing: 'true', next: 'false', enabled: false })
    ).toBe('false');
  });

  it('accepts first classification when nothing is stored', () => {
    expect(
      persistKnownTrueMonotonically({ existing: undefined, next: 'unknown', enabled: true })
    ).toBe('unknown');
  });
});

describe('resolveActivatedToolPolicy', () => {
  it('seals an activated unknown plugin without a handler as false', () => {
    expect(resolveActivatedToolPolicy({
      existing: 'unknown',
      declared: undefined,
      hasServer: true,
      registeredHandler: false,
      enabled: true
    })).toBe('false');
  });

  it('does not demote an enabled known true after activation', () => {
    expect(resolveActivatedToolPolicy({
      existing: 'true',
      declared: false,
      hasServer: true,
      registeredHandler: false,
      enabled: true
    })).toBe('true');
  });
});

describe('createToolPolicyInventoryState', () => {
  it('starts as a valid empty snapshot', () => {
    const state = createToolPolicyInventoryState();
    expect(state.snapshot()).toEqual({
      revision: 0,
      source: 'valid-empty',
      entries: []
    });
  });

  it('replaces with an immutable loaded snapshot and increments revision', () => {
    const state = createToolPolicyInventoryState();
    const next = state.replace({
      source: 'loaded',
      entries: [entry({ pluginId: 'alpha' })]
    });
    expect(next.revision).toBe(1);
    expect(next.source).toBe('loaded');
    expect(() => {
      (next.entries as ToolPolicyInventoryEntry[]).push(entry({ pluginId: 'beta' }));
    }).toThrow();
    expect(state.snapshot().entries).toHaveLength(1);
  });

  it('retains last inventory on persistence error and records the reason', () => {
    const state = createToolPolicyInventoryState();
    state.replace({ source: 'loaded', entries: [entry()] });
    const retained = state.retainAfterError('read-failed');
    expect(retained.reason).toBe('read-failed');
    expect(retained.snapshot.source).toBe('retained-after-error');
    expect(retained.snapshot.revision).toBe(2);
    expect(retained.snapshot.entries).toEqual([entry()]);
  });
});

describe('requiredPolicyPluginIds', () => {
  it('returns only enabled true or unknown plugins', () => {
    expect(
      requiredPolicyPluginIds({
        revision: 1,
        source: 'loaded',
        entries: [
          entry({ pluginId: 'need-true', toolPolicy: 'true' }),
          entry({ pluginId: 'need-unknown', toolPolicy: 'unknown' }),
          entry({ pluginId: 'explicit-false', toolPolicy: 'false' }),
          entry({ pluginId: 'disabled-true', enabled: false, toolPolicy: 'true' })
        ]
      })
    ).toEqual(['need-true', 'need-unknown']);
  });
});

describe('tool policy stamps', () => {
  it('compares required generations and revisions', () => {
    const snapshot = {
      revision: 3,
      source: 'loaded' as const,
      entries: [entry({ pluginId: 'need-true', toolPolicy: 'true' })]
    };
    const first = captureToolPolicyStamp(snapshot, new Map([['need-true', 'gen-1']]));
    const second = captureToolPolicyStamp(snapshot, new Map([['need-true', 'gen-1']]));
    const changed = captureToolPolicyStamp(snapshot, new Map([['need-true', 'gen-2']]));
    expect(sameToolPolicyStamp(first, second)).toBe(true);
    expect(sameToolPolicyStamp(first, changed)).toBe(false);
  });
});
