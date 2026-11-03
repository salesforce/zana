import { dirname, join, relative, resolve } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { afterEach, expect, it, vi } from 'vitest';
import { defaultCloneGit } from './plugin-process.js';
import { runPluginSourceCommand } from './plugin-source-command.js';

vi.mock('./plugin-source-command.js', () => ({ runPluginSourceCommand: vi.fn() }));
const roots: string[] = [];
afterEach(() => { vi.clearAllMocks(); roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })); });

it.each(['HEAD', `commit:${'a'.repeat(40)}`])('runs every Git child outside the disposable generation (%s)', async spec => {
  const root = mkdtempSync(join(tmpdir(), 'plugin-cwd-')); roots.push(root);
  const dest = join(root, 'generations', 'disposable', 'git');
  vi.mocked(runPluginSourceCommand).mockResolvedValue({ code: 0, stdout: 'a'.repeat(40), stderr: '' });
  await defaultCloneGit('https://example.test/plugin.git', dest, spec);
  for (const [, , cwd] of vi.mocked(runPluginSourceCommand).mock.calls) {
    expect(cwd).toBe(dirname(dirname(dest)));
  }
});

it.each(['HEAD', `commit:${'a'.repeat(40)}`])('passes Git an absolute destination when given a relative one (%s)', async spec => {
  const root = mkdtempSync(join(tmpdir(), 'plugin-cwd-')); roots.push(root);
  const absolute = join(root, 'generations', 'disposable', 'git');
  vi.mocked(runPluginSourceCommand).mockResolvedValue({ code: 0, stdout: 'a'.repeat(40), stderr: '' });
  await defaultCloneGit('https://example.test/plugin.git', relative(process.cwd(), absolute), spec);
  for (const [, args, cwd] of vi.mocked(runPluginSourceCommand).mock.calls) {
    expect(cwd).toBe(dirname(dirname(absolute)));
    expect(args[0] === 'clone' ? args.at(-1) : args[1]).toBe(resolve(absolute));
  }
});
