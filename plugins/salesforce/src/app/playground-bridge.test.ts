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
import { AGENT_SOURCE_MAX } from '../../lib/studio-contract.js';

describe('playground bridge', () => {
  it('bounds graph snapshots and requires explicit visibility and theme', () => {
    const graph = { source: PLAYGROUND_BRIDGE_SOURCE, type: 'graph', content: 'start_agent:', visible: true, theme: 'dark' };
    expect(isHostToPlayground(graph)).toBe(true);
    for (const change of [{ content: 42 }, { content: 'x'.repeat(AGENT_SOURCE_MAX + 1) }, { visible: 'yes' }, { theme: 'unknown' }]) {
      expect(isHostToPlayground({ ...graph, ...change })).toBe(false);
    }
  });
  it('accepts and bounds the optional compact, focus and focusSeq graph fields', () => {
    const graph = { source: PLAYGROUND_BRIDGE_SOURCE, type: 'graph', content: 'start_agent:', visible: true, theme: 'light' };
    expect(isHostToPlayground({ ...graph, compact: true, focus: 'topic.returns', focusSeq: 3 })).toBe(true);
    expect(isHostToPlayground({ ...graph, compact: false, focusSeq: 0 })).toBe(true);
    for (const change of [{ compact: 'yes' }, { focus: 7 }, { focus: 'x'.repeat(201) }, { focusSeq: -1 }, { focusSeq: 1.5 }, { focusSeq: '2' }, { focusSeq: 2_000_000_000 }]) {
      expect(isHostToPlayground({ ...graph, ...change })).toBe(false);
    }
  });
  it('accepts bounded test coverage and a pinned case on graph snapshots, and draft-case requests back', () => {
    const graph = { source: PLAYGROUND_BRIDGE_SOURCE, type: 'graph', content: 'start_agent:', visible: true, theme: 'light' };
    const coverage = { cases: [{ id: 'a', name: 'A', outcome: 'pass', path: ['start_agent'], missing: [] }] };
    expect(isHostToPlayground({ ...graph, coverage, focusCase: 'a' })).toBe(true);
    expect(isHostToPlayground({ ...graph, coverage: null })).toBe(true);
    for (const change of [{ coverage: { cases: [{ id: 1 }] } }, { coverage: 'x' }, { focusCase: 4 }, { focusCase: 'x'.repeat(201) }]) {
      expect(isHostToPlayground({ ...graph, ...change })).toBe(false);
    }
    const draft = { source: PLAYGROUND_BRIDGE_SOURCE, type: 'draftCases', labels: ['Errors'] };
    expect(isPlaygroundToHost(draft)).toBe(true);
    for (const labels of [[], 'Errors', [''], [7], Array(51).fill('a'), ['x'.repeat(201)]]) expect(isPlaygroundToHost({ ...draft, labels })).toBe(false);
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
    const changed = { source: PLAYGROUND_BRIDGE_SOURCE, type: 'fileChanged', draftKey: 'k', content: 'x', sha256: 'f'.repeat(64) };
    expect(isHostToPlayground(changed)).toBe(true);
    for (const change of [{ draftKey: '' }, { draftKey: 'k'.repeat(2001) }, { content: 1 }, { content: 'x'.repeat(AGENT_SOURCE_MAX + 1) }, { sha256: 'abc' }, { sha256: 'F'.repeat(64) }]) {
      expect(isHostToPlayground({ ...changed, ...change })).toBe(false);
    }
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
    // A large org agent (hundreds of KB) still reaches the Studio, up to 10 MB.
    expect(isPlaygroundToHost({ ...snapshot, content: 'x'.repeat(373_285) })).toBe(true);
    expect(isPlaygroundToHost({ ...snapshot, content: 'x'.repeat(AGENT_SOURCE_MAX) })).toBe(true);
    expect(isPlaygroundToHost({ ...snapshot, content: 'x'.repeat(AGENT_SOURCE_MAX + 1) })).toBe(false);
    expect(isPlaygroundToHost({ ...snapshot, issues: NaN })).toBe(false);
    expect(isPlaygroundToHost({ ...snapshot, content: null })).toBe(false);
    const actions = parseAgentScriptSource(ACTION_AGENT, 'agentforce').actions;
    expect(isPlaygroundToHost({ ...snapshot, actions })).toBe(true);
    for (const invalid of [null, [{}], [{ ...actions[0], inputs: null }], [{ ...actions[0], uses: [{ kind: 'run', line: 0, code: '' }] }], Array(251).fill(actions[0])]) expect(isPlaygroundToHost({ ...snapshot, actions: invalid })).toBe(false);
    expect(isPlaygroundToHost({ source: PLAYGROUND_BRIDGE_SOURCE, type: 'openAction', id: actions[0].id })).toBe(true);
    expect(isHostToPlayground({ source: PLAYGROUND_BRIDGE_SOURCE, type: 'reference', content: 'x', language: 'apex' })).toBe(true);
    expect(isHostToPlayground({ source: PLAYGROUND_BRIDGE_SOURCE, type: 'reference', content: 'x'.repeat(750001), language: 'apex' })).toBe(false);
    expect(isHostToPlayground({ source: PLAYGROUND_BRIDGE_SOURCE, type: 'reference', content: 'x', language: 'agentscript', line: 4 })).toBe(true);
    expect(isHostToPlayground({ source: PLAYGROUND_BRIDGE_SOURCE, type: 'reference', content: 'x', language: 'yaml' })).toBe(false);
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
    rejects(isPlaygroundToHost, { type: 'proposalResolved', proposalId: 'p1', outcome: 'partial', acceptedHunks: 1, rejectedHunks: 1, content: 'x', sha256: 'abc' }, [{ proposalId: '' }, { proposalId: 5 }, { outcome: 'nope' }, { acceptedHunks: -1 }, { content: 3 }, { content: 'x'.repeat(AGENT_SOURCE_MAX + 1) }]);
  });
  it('validates commentAction, askSelection and saveRequest', () => {
    rejects(isPlaygroundToHost, { type: 'commentAction', kind: 'open', line: 1, endLine: 2, quote: 'q' }, [{ kind: 'add' }, { kind: 'delete' }, { line: 0 }, { endLine: 0 }, { quote: 1 }, { quote: 'x'.repeat(2001) }, { body: 'stray' }]);
    rejects(isPlaygroundToHost, { type: 'commentAction', kind: 'submit', line: 1, endLine: 2, quote: 'q', body: 'Needs work' }, [{ body: undefined }, { body: '  ' }, { body: 3 }, { body: 'x'.repeat(2001) }, { endLine: 0 }, { id: 'c1' }]);
    rejects(isPlaygroundToHost, { type: 'commentAction', kind: 'update', id: 'c1', line: 1, endLine: 2, quote: 'q', body: 'Reworded' }, [{ id: undefined }, { id: '' }, { id: 'x'.repeat(65) }, { id: 3 }, { body: undefined }, { body: '  ' }]);
    rejects(isPlaygroundToHost, { type: 'commentAction', kind: 'delete', id: 'c1', line: 1, endLine: 1, quote: '' }, [{ id: undefined }, { body: 'stray' }]);
    rejects(isPlaygroundToHost, { type: 'askSelection', action: 'explain-selection', startLine: 1, endLine: 2, text: 't' }, [{ action: '' }, { action: 'x'.repeat(65) }, { startLine: 3 }, { text: 'x'.repeat(2001) }, { text: 1 }]);
    expect(isPlaygroundToHost(m({ type: 'saveRequest' }))).toBe(true);
  });
  it('validates host messages for proposals, comments, hits and layout', () => {
    rejects(isHostToPlayground, { type: 'proposeEdit', proposalId: 'p', content: 'c', summary: 's', actor: 'a' }, [{ proposalId: '' }, { content: 1 }, { content: 'x'.repeat(AGENT_SOURCE_MAX + 1) }, { summary: 'x'.repeat(1001) }, { actor: 3 }]);
    rejects(isHostToPlayground, { type: 'clearProposal', proposalId: 'p' }, [{ proposalId: 1 }]);
    rejects(isHostToPlayground, { type: 'setComments', comments: [comment] }, [{ comments: [{ ...comment, line: 0 }] }, { comments: 'x' }, { comments: Array(501).fill(comment) }]);
    rejects(isHostToPlayground, { type: 'setHits', lines: [1, 2] }, [{ lines: [0] }, { lines: 'x' }, { lines: Array(1001).fill(1) }]);
    rejects(isHostToPlayground, { type: 'setLayout', compact: true }, [{ compact: 'yes' }]);
    rejects(isHostToPlayground, { type: 'setReadOnly', readOnly: true, content: 'x' }, [{ readOnly: 'yes' }, { content: 3 }, { content: 'x'.repeat(AGENT_SOURCE_MAX + 1) }]);
    expect(isHostToPlayground({ source: PLAYGROUND_BRIDGE_SOURCE, type: 'setReadOnly', readOnly: false })).toBe(true);
    // A re-baseline names the saved text and its sha together.
    rejects(isHostToPlayground, { type: 'setReadOnly', readOnly: false, baseline: 'disk', baseSha: 'a'.repeat(64) },
      [{ baseSha: undefined }, { baseSha: 'A'.repeat(64) }, { baseSha: 'a'.repeat(63) }, { baseline: 3 }, { baseline: undefined }, { baseline: 'x'.repeat(AGENT_SOURCE_MAX + 1) }]);
  });
});
