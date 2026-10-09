import { describe, expect, it } from 'vitest';
import { parseAgentScriptSource } from '../../lib/agent-script-parse.js';
import { ACTION_AGENT } from '../action-fixtures.js';
import {
  isHostToPlayground,
  isPlaygroundToHost,
  PLAYGROUND_ASSET_SRC,
  PLAYGROUND_BRIDGE_SOURCE,
  readDocumentTheme
} from './playground-bridge.js';

describe('playground bridge', () => {
  it('bounds graph snapshots and requires explicit visibility and theme', () => {
    const graph = { source: PLAYGROUND_BRIDGE_SOURCE, type: 'graph', content: 'start_agent:', visible: true, theme: 'dark' };
    expect(isHostToPlayground(graph)).toBe(true);
    for (const change of [{ content: 42 }, { content: 'x'.repeat(180_001) }, { visible: 'yes' }, { theme: 'unknown' }]) {
      expect(isHostToPlayground({ ...graph, ...change })).toBe(false);
    }
  });
  it('validates draft identities and save-as flags before accepting editor messages', () => {
    const persist = { source: PLAYGROUND_BRIDGE_SOURCE, type: 'persist', path: 'New.agent', content: 'source', draftKey: 'p:example:one', create: true };
    expect(isPlaygroundToHost(persist)).toBe(true);
    for (const change of [{ draftKey: 42 }, { draftKey: 'x'.repeat(2001) }, { create: 'true' }, { baseSha: 42 }, { persisted: 'yes' }]) {
      expect(isPlaygroundToHost({ ...persist, ...change })).toBe(false);
    }
    expect(isPlaygroundToHost({ source: PLAYGROUND_BRIDGE_SOURCE, type: 'dirty', dirty: true, draftKey: 'p:file:a.agent', baseSha: 'original', persisted: false })).toBe(true);
  });

  it('accepts typed host and playground messages', () => {
    expect(PLAYGROUND_ASSET_SRC).toContain('/plugins/salesforce/assets/playground/');
    expect(
      isPlaygroundToHost({ source: PLAYGROUND_BRIDGE_SOURCE, type: 'ready' })
    ).toBe(true);
    expect(
      isPlaygroundToHost({ source: PLAYGROUND_BRIDGE_SOURCE, type: 'persist', path: 'a.agent', content: 'x' })
    ).toBe(true);
    expect(isPlaygroundToHost({ source: 'other', type: 'ready' })).toBe(false);
    expect(
      isHostToPlayground({ source: PLAYGROUND_BRIDGE_SOURCE, type: 'flushSave' })
    ).toBe(true);
    expect(
      isHostToPlayground({ source: PLAYGROUND_BRIDGE_SOURCE, type: 'setDialect', dialect: 'agentscript' })
    ).toBe(true);
    expect(
      isHostToPlayground({ source: PLAYGROUND_BRIDGE_SOURCE, type: 'setOrg', org: null })
    ).toBe(true);
    expect(isHostToPlayground({ type: 'flushSave' })).toBe(false);
    expect(isPlaygroundToHost({ source: PLAYGROUND_BRIDGE_SOURCE, type: 'dirty' })).toBe(false);
    expect(isPlaygroundToHost({ source: PLAYGROUND_BRIDGE_SOURCE, type: 'dirty', dirty: true })).toBe(true);
  });

  it('reads light and dark document themes', () => {
    const scope = globalThis as { document?: { documentElement: { getAttribute(name: string): string | null } } };
    const previous = scope.document;
    scope.document = { documentElement: { getAttribute: () => 'light' } };
    expect(readDocumentTheme()).toBe('light');
    scope.document = { documentElement: { getAttribute: () => 'dark' } };
    expect(readDocumentTheme()).toBe('dark');
    scope.document = previous;
  });

  it('bounds editor snapshots and rejects malformed analysis counts', () => {
    const snapshot = { source: PLAYGROUND_BRIDGE_SOURCE, type: 'snapshot', content: 'start_agent:', issues: 0 };
    expect(isPlaygroundToHost(snapshot)).toBe(true);
    expect(isPlaygroundToHost({ ...snapshot, content: 'x'.repeat(180_001) })).toBe(false);
    expect(isPlaygroundToHost({ ...snapshot, issues: NaN })).toBe(false);
    expect(isPlaygroundToHost({ ...snapshot, content: null })).toBe(false);
    const actions = parseAgentScriptSource(ACTION_AGENT, 'agentforce').actions;
    expect(isPlaygroundToHost({ ...snapshot, actions })).toBe(true);
    for (const invalid of [null, [{}], [{ ...actions[0], inputs: null }], [{ ...actions[0], uses: [{ kind: 'run', line: 0, code: '' }] }], Array(251).fill(actions[0])]) expect(isPlaygroundToHost({ ...snapshot, actions: invalid })).toBe(false);
    expect(isPlaygroundToHost({ source: PLAYGROUND_BRIDGE_SOURCE, type: 'openAction', id: actions[0].id })).toBe(true);
    expect(isHostToPlayground({ source: PLAYGROUND_BRIDGE_SOURCE, type: 'reference', content: 'x', language: 'apex' })).toBe(true);
    expect(isHostToPlayground({ source: PLAYGROUND_BRIDGE_SOURCE, type: 'reference', content: 'x'.repeat(750001), language: 'apex' })).toBe(false);
    expect(isHostToPlayground({ source: PLAYGROUND_BRIDGE_SOURCE, type: 'revealLine', line: -1 })).toBe(false);
    expect(isHostToPlayground({ source: PLAYGROUND_BRIDGE_SOURCE, type: 'revealLine', line: 3 })).toBe(true);
  });
});

describe('studio bridge messages', () => {
  const m = <T extends object>(body: T) => ({ source: PLAYGROUND_BRIDGE_SOURCE, ...body });
  const comment = { id: 'c', path: 'a.agent', line: 1, endLine: 2, quote: 'q', body: 'b', author: { kind: 'user', name: 'me' }, createdAt: 1 };
  const diag = { line: 1, column: 1, endLine: 1, endColumn: 2, severity: 'warning', message: 'm' };
  const rejects = (guard: (v: unknown) => boolean, base: object, changes: object[]) => {
    expect(guard(m(base))).toBe(true);
    for (const change of changes) expect(guard(m({ ...base, ...change }))).toBe(false);
  };

  it('accepts snapshot diagnostics up to 200 and rejects invalid ones', () => {
    const snap = { type: 'snapshot', content: 'x', issues: 1 };
    rejects(isPlaygroundToHost, { ...snap, diagnostics: Array(200).fill(diag) }, [{ diagnostics: Array(201).fill(diag) }, { diagnostics: [{ ...diag, severity: 'x' }] }, { diagnostics: 'no' }]);
    expect(isPlaygroundToHost(m(snap))).toBe(true);
  });
  it('validates cursor and selection', () => {
    rejects(isPlaygroundToHost, { type: 'cursor', line: 3, column: 2, selection: { startLine: 3, endLine: 4, text: 'abc' } }, [{ line: 0 }, { column: 1.5 }, { selection: { startLine: 4, endLine: 3, text: '' } }, { selection: { startLine: 1, endLine: 1, text: 'x'.repeat(2001) } }, { selection: 'x' }]);
    expect(isPlaygroundToHost(m({ type: 'cursor', line: 1, column: 1 }))).toBe(true);
  });
  it('validates proposalResolved with the outcome shape', () => {
    rejects(isPlaygroundToHost, { type: 'proposalResolved', proposalId: 'p1', outcome: 'partial', acceptedHunks: 1, rejectedHunks: 1, content: 'x', sha256: 'abc' }, [{ proposalId: '' }, { proposalId: 5 }, { outcome: 'nope' }, { acceptedHunks: -1 }, { content: 3 }, { content: 'x'.repeat(180_001) }]);
  });
  it('validates commentAction, askSelection and saveRequest', () => {
    rejects(isPlaygroundToHost, { type: 'commentAction', kind: 'add', line: 1, endLine: 2, quote: 'q' }, [{ kind: 'delete' }, { line: 0 }, { endLine: 0 }, { quote: 1 }, { quote: 'x'.repeat(2001) }]);
    rejects(isPlaygroundToHost, { type: 'askSelection', action: 'explain-selection', startLine: 1, endLine: 2, text: 't' }, [{ action: '' }, { action: 'x'.repeat(65) }, { startLine: 3 }, { text: 'x'.repeat(2001) }, { text: 1 }]);
    expect(isPlaygroundToHost(m({ type: 'saveRequest' }))).toBe(true);
  });
  it('validates host messages for proposals, comments, hits and layout', () => {
    rejects(isHostToPlayground, { type: 'proposeEdit', proposalId: 'p', content: 'c', summary: 's', actor: 'a' }, [{ proposalId: '' }, { content: 1 }, { content: 'x'.repeat(180_001) }, { summary: 'x'.repeat(1001) }, { actor: 3 }]);
    rejects(isHostToPlayground, { type: 'clearProposal', proposalId: 'p' }, [{ proposalId: 1 }]);
    rejects(isHostToPlayground, { type: 'setComments', comments: [comment] }, [{ comments: [{ ...comment, line: 0 }] }, { comments: 'x' }, { comments: Array(501).fill(comment) }]);
    rejects(isHostToPlayground, { type: 'setHits', lines: [1, 2] }, [{ lines: [0] }, { lines: 'x' }, { lines: Array(1001).fill(1) }]);
    rejects(isHostToPlayground, { type: 'setLayout', compact: true }, [{ compact: 'yes' }]);
  });
});
