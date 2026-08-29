import { describe, it, expect, vi } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Council ticket C1 — "structural no-code/no-exec enforcement". This guard
// proves the built-in orchestrator persona is mechanically unable to write
// code or run shell commands: not by prompt, but by the CLI flags the persona
// emits. If someone weakens the allowlist or drops the denylist, this test
// fails before it ships.

const testHome = join(tmpdir(), `orchestrator-guard-test-${Date.now()}`);
vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'home') return testHome;
      throw new Error(`Unexpected getPath('${name}')`);
    }
  },
  shell: { openPath: vi.fn() }
}));

import { PersonaStore, ORCHESTRATOR_DENIED_TOOLS } from '../persona-store.js';
import { personaArgs_build } from '@zana-ai/zcc-host-daemon/pty';
import type { Persona } from '@zana-ai/zcc-domain/product';

function orchestrator(): Persona {
  const store = new PersonaStore(() => []);
  store.start();
  try {
    const p = store.list().find((x) => x.id === 'builtin:orchestrator');
    if (!p) throw new Error('builtin:orchestrator persona missing');
    return p;
  } finally {
    store.stop();
  }
}

describe('orchestrator persona — no-code guardrail', () => {
  it('denies every code-mutating / command-executing tool', () => {
    const p = orchestrator();
    for (const tool of ['Write', 'Edit', 'NotebookEdit', 'Bash']) {
      expect(p.deniedTools).toContain(tool);
    }
  });

  // `MultiEdit` was folded into `Edit` in the current claude CLI and is no
  // longer a registered tool. Denying it makes the CLI warn "matches no known
  // tool" on launch, so it MUST NOT appear in the denylist — denying `Edit`
  // already covers the multi-edit surface.
  it('does not deny the retired MultiEdit tool', () => {
    const p = orchestrator();
    expect(p.deniedTools).not.toContain('MultiEdit');
    expect(ORCHESTRATOR_DENIED_TOOLS).not.toContain('MultiEdit');
  });

  it('never lists a write/exec tool in its allowlist', () => {
    const p = orchestrator();
    const forbidden = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash'];
    for (const tool of forbidden) {
      expect(p.allowedTools ?? []).not.toContain(tool);
    }
  });

  it('allows only read-only inspection + delegation MCP surfaces', () => {
    const p = orchestrator();
    // Whatever the allowlist contains, it must be a subset of the safe set —
    // read-only tools plus the zana_*/zcc delegation MCP servers.
    const SAFE = new Set([
      'Read',
      'Grep',
      'Glob',
      // AskUserQuestion only surfaces a multiple-choice prompt to the human — it
      // cannot mutate code or run commands, so it stays within the no-code guarantee.
      'AskUserQuestion',
      'TodoWrite',
      'mcp__zana',
      'mcp__zcc-inbox'
    ]);
    for (const tool of p.allowedTools ?? []) {
      expect(SAFE.has(tool)).toBe(true);
    }
    // And it must actually carry the delegation surface, or it can't delegate.
    expect(p.allowedTools).toContain('mcp__zana');
  });

  it('emits --disallowedTools covering Write/Edit/Bash on the command line', () => {
    const p = orchestrator();
    const argv = personaArgs_build(p, p.baseProfile ?? 'claude');
    const i = argv.indexOf('--disallowedTools');
    expect(i).toBeGreaterThanOrEqual(0);
    const denied = argv[i + 1].split(',');
    for (const tool of ORCHESTRATOR_DENIED_TOOLS) {
      expect(denied).toContain(tool);
    }
    // The denylist must be the same source of truth the persona ships.
    expect(p.deniedTools).toEqual([...ORCHESTRATOR_DENIED_TOOLS]);
  });
});
