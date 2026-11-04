import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { seedOpenCodeAuthState } from '../../../../e2e/fixtures/opencode-auth.js';

const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'native-auth-fixture-')); roots.push(root);
  const source = join(root, 'source'), sandbox = join(root, 'sandbox');
  mkdirSync(source); mkdirSync(sandbox);
  return { source, sandbox };
}
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));

describe('native OpenCode auth fixture', () => {
  it('copies config and auth while excluding executable plugin trees before traversal', () => {
    const f = fixture();
    const config = join(f.source, '.config/opencode'), data = join(f.source, '.local/share/opencode');
    mkdirSync(join(config, 'plugins'), { recursive: true }); mkdirSync(join(config, 'plugin'));
    mkdirSync(data, { recursive: true });
    writeFileSync(join(config, 'opencode.json'), '{"provider":{"custom":{}}}');
    writeFileSync(join(config, 'plugins/hook.js'), 'throw Error("must not run")');
    symlinkSync(join(f.source, 'missing'), join(config, 'plugin/dangling'));
    writeFileSync(join(data, 'auth.json'), '{"custom":"fixture-key"}');
    const before = readFileSync(join(config, 'opencode.json'), 'utf8');
    expect(seedOpenCodeAuthState(f.sandbox, f.source)).toBe(true);
    expect(readFileSync(join(f.sandbox, '.config/opencode/opencode.json'), 'utf8')).toBe(before);
    expect(readFileSync(join(f.sandbox, '.local/share/opencode/auth.json'), 'utf8')).toContain('fixture-key');
    expect(existsSync(join(f.sandbox, '.config/opencode/plugins'))).toBe(false);
    expect(existsSync(join(f.sandbox, '.config/opencode/plugin'))).toBe(false);
    expect(readFileSync(join(config, 'opencode.json'), 'utf8')).toBe(before);
    expect(existsSync(join(config, 'plugins/hook.js'))).toBe(true);
    expect(lstatSync(join(f.sandbox, '.config/opencode')).isSymbolicLink()).toBe(false);
  });

  it('materializes native file links privately and excludes linked directory trees', () => {
    const f = fixture(); const config = join(f.source, '.config/opencode');
    mkdirSync(config, { recursive: true });
    writeFileSync(join(f.source, 'auth.json'), 'real-auth');
    symlinkSync(join(f.source, 'auth.json'), join(config, 'auth.json'));
    symlinkSync(f.source, join(config, 'outside'));
    symlinkSync(join(f.source, 'missing'), join(config, 'dangling'));
    expect(seedOpenCodeAuthState(f.sandbox, f.source)).toBe(true);
    const copied = join(f.sandbox, '.config/opencode/auth.json');
    expect(lstatSync(copied).isSymbolicLink()).toBe(false);
    writeFileSync(copied, 'sandbox-auth');
    expect(readFileSync(join(f.source, 'auth.json'), 'utf8')).toBe('real-auth');
    expect(existsSync(join(f.sandbox, '.config/opencode/outside'))).toBe(false);
    expect(existsSync(join(f.sandbox, '.config/opencode/dangling'))).toBe(false);
  });

  it('does not discover or copy unrelated installer state', () => {
    const f = fixture(); mkdirSync(join(f.source, '.custom-installer'));
    writeFileSync(join(f.source, '.custom-installer/auth'), 'unrelated');
    expect(seedOpenCodeAuthState(f.sandbox, f.source)).toBe(false);
    expect(existsSync(join(f.sandbox, '.custom-installer'))).toBe(false);
  });

  it('copies only the existing optional auth helper socket without linking its directory', () => {
    const f = fixture(); const helper = join(f.source, '.devbar'); mkdirSync(helper);
    writeFileSync(join(helper, 'devbar.sock'), 'socket-fixture'); writeFileSync(join(helper, 'state'), 'private');
    expect(seedOpenCodeAuthState(f.sandbox, f.source)).toBe(false);
    expect(lstatSync(join(f.sandbox, '.devbar/devbar.sock')).isSymbolicLink()).toBe(true);
    expect(lstatSync(join(f.sandbox, '.devbar')).isSymbolicLink()).toBe(false);
    expect(existsSync(join(f.sandbox, '.devbar/state'))).toBe(false);
    expect(() => seedOpenCodeAuthState(f.sandbox, f.source)).not.toThrow();
  });

  it('tolerates an unreadable native destination and never writes back to its source', () => {
    const f = fixture(); mkdirSync(join(f.source, '.config/opencode'), { recursive: true });
    writeFileSync(join(f.source, '.config/opencode/auth.json'), 'original');
    writeFileSync(join(f.sandbox, '.config'), 'blocked');
    expect(seedOpenCodeAuthState(f.sandbox, f.source)).toBe(false);
    expect(readFileSync(join(f.source, '.config/opencode/auth.json'), 'utf8')).toBe('original');
  });
});
