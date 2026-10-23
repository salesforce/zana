import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SESSION_CALLBACK_ENV_KEYS } from '../tmux-session-env.js';

// A tmux pane inherits the tmux SERVER's env, so every per-session ZCC_* var the
// launch writes into its env must ride `new-session -e`. This guard fails when a
// source file starts setting a new ZCC_* var without classifying it.
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Control-plane identity vars. Deliberately NOT forwarded through `-e`: tmux `-e`
 * values sit on the client's argv (visible to `ps`), and the token is a bearer
 * credential. A 2nd+ tmux pane therefore still inherits the server snapshot's
 * identity until a file-based hand-off replaces this exemption.
 */
const IDENTITY_NOT_FORWARDED = ['ZCC_SESSION_ID', 'ZCC_SESSION_TOKEN'];

function assignedZccVars(relPath: string): string[] {
  const text = readFileSync(join(SRC, relPath), 'utf8')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');
  const found = new Set<string>();
  for (const m of text.matchAll(/\benv\.(ZCC_[A-Z0-9_]+)\s*=(?!=)/g)) found.add(m[1] as string);
  for (const m of text.matchAll(/^\s*(ZCC_[A-Z0-9_]+)\s*:\s*(?:sessionId|sessionCredential)\b/gm)) {
    found.add(m[1] as string);
  }
  return [...found];
}

describe('tmux per-session env coverage', () => {
  const classified = new Set<string>([...SESSION_CALLBACK_ENV_KEYS, ...IDENTITY_NOT_FORWARDED]);

  for (const file of ['pty.ts', 'harness/claude/hooks.ts']) {
    it(`${file}: every ZCC_* var set on the launch env is forwarded through tmux -e`, () => {
      const vars = assignedZccVars(file);
      expect(vars.length).toBeGreaterThan(0);
      expect(vars.filter((v) => !classified.has(v))).toEqual([]);
    });
  }

  it('pty.ts forwards every callback key generically and never puts identity on the tmux argv', () => {
    const text = readFileSync(join(SRC, 'pty.ts'), 'utf8');
    const start = text.indexOf('const sessionEnv:');
    const block = text.slice(start, text.indexOf('};', start));
    expect(start).toBeGreaterThan(0);
    expect(block).toContain('SESSION_CALLBACK_ENV_KEYS.map');
    for (const key of IDENTITY_NOT_FORWARDED) expect(block).not.toContain(key);
  });
});
