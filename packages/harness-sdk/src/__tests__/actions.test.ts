import { describe, it, expect } from 'vitest';
import {
  assertNeverAction,
  type AgentAction,
  type AgentActionKind,
  type AgentActionResult
} from '../actions.js';

/**
 * Exhaustive-match guard (T1.2 AC). `describe`/`route` switch over every
 * AgentAction.kind and pass the default case to `assertNeverAction`. If a new
 * action variant is added without a case here, this file fails to COMPILE —
 * that compile error is the guard. The runtime assertions below just confirm
 * the router is total over the current union.
 */
function route(action: AgentAction): AgentActionKind {
  switch (action.kind) {
    case 'exec':
      return action.kind;
    case 'readFiles':
      return action.kind;
    case 'writeFile':
      return action.kind;
    case 'editFiles':
      return action.kind;
    case 'grep':
      return action.kind;
    case 'glob':
      return action.kind;
    case 'mcpCall':
      return action.kind;
    case 'readMcpResource':
      return action.kind;
    case 'spawnChild':
      return action.kind;
    case 'askUser':
      return action.kind;
    default:
      return assertNeverAction(action);
  }
}

const SAMPLES: AgentAction[] = [
  { kind: 'exec', command: 'ls -la' },
  { kind: 'readFiles', paths: ['a.ts', 'b.ts'] },
  { kind: 'writeFile', path: 'a.ts', content: 'x' },
  { kind: 'editFiles', edits: [{ path: 'a.ts', oldText: 'x', newText: 'y' }] },
  { kind: 'grep', pattern: 'foo' },
  { kind: 'glob', pattern: '**/*.ts' },
  { kind: 'mcpCall', tool: 'zana__zana_status', args: {} },
  { kind: 'readMcpResource', server: 'zana', uri: 'zana://x' },
  { kind: 'spawnChild', prompt: 'do a thing' },
  { kind: 'askUser', question: 'ok?', options: ['yes', 'no'] }
];

describe('AgentAction protocol', () => {
  it('routes every action kind through an exhaustive switch', () => {
    for (const a of SAMPLES) {
      expect(route(a)).toBe(a.kind);
    }
  });

  it('covers all 10 declared action kinds with a sample', () => {
    const kinds = new Set(SAMPLES.map((a) => a.kind));
    expect(kinds.size).toBe(10);
  });

  it('assertNeverAction throws on an unexpected shape (runtime backstop)', () => {
    // Cast through unknown — simulates a malformed action reaching the default.
    expect(() => assertNeverAction({ kind: 'bogus' } as unknown as never)).toThrow(
      /Unhandled AgentAction kind: bogus/
    );
  });

  it('AgentActionResult envelope is uniform across kinds', () => {
    const ok: AgentActionResult = { kind: 'grep', ok: true, output: 'match' };
    const denied: AgentActionResult = { kind: 'exec', ok: false, denied: true, error: 'blocked' };
    expect(ok.ok).toBe(true);
    expect(denied.denied).toBe(true);
  });
});
