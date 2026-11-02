import { afterAll, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const gitCalls = vi.hoisted(() => [] as Array<{ args: readonly string[]; options: Record<string, unknown> }>);
const h = vi.hoisted(() => ({ home: '' }));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    execFile: (command: string, args: readonly string[], options: Record<string, unknown>, callback: (...a: unknown[]) => void) => {
      if (command === 'git') gitCalls.push({ args, options });
      if (command === 'git' && args[0] === 'clone') {
        // No network in tests: stand in for a successful clone with an empty repo.
        actual.execFileSync('git', ['init', '-q', args[args.length - 1]!]);
        callback(null, '', '');
        return { stderr: null };
      }
      return actual.execFile(command, args, options, callback as never);
    },
    execFileSync: (command: string, args: readonly string[], options: Record<string, unknown>) => {
      if (command === 'git') gitCalls.push({ args, options });
      return actual.execFileSync(command, args, options);
    }
  };
});

h.home = mkdtempSync(join(tmpdir(), 'zcc-clone-hide-home-'));
vi.mock('electron', () => ({ app: { getPath: () => h.home } }));

const { cloneProject } = await import('./git-clone.js');
const { store } = await import('./store.js');
// Test setup goes through the real module so only product calls are recorded.
const { execFileSync: realGit } = await vi.importActual<typeof import('node:child_process')>('node:child_process');

afterAll(() => rmSync(h.home, { recursive: true, force: true }));

// The server runs under Electron (a GUI process), so on Windows each git child
// needs windowsHide or it opens a visible console window.
describe('clone and project-store git calls hide their console window', () => {
  it('passes windowsHide on clone, checkout, rev-parse and origin lookups', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'zcc-clone-hide-')));
    try {
      // Fresh clone with a ref: clone, then checkout (fails on the empty repo).
      const cloned = await cloneProject({ url: 'https://github.com/owner/repo', destBase: root, ref: 'v1' });
      expect(cloned.ok).toBe(false);
      // An existing non-empty destination: its origin is read before refusing.
      mkdirSync(join(root, 'other', 'keep'), { recursive: true });
      realGit('git', ['init', '-q', join(root, 'other')]);
      const existing = await cloneProject({ url: 'https://github.com/owner/other', destBase: root });
      expect(existing.ok).toBe(false);

      const dir = store.createScratchSubfolder('clone https://github.com/acme/widget');
      realGit('git', ['init', '-q', dir]);
      realGit('git', ['-C', dir, 'remote', 'add', 'origin', 'https://github.com/acme/widget.git']);
      expect(store.addProject(dir).name).toBe('widget');

      const joined = gitCalls.map((call) => call.args.join(' '));
      expect(joined.some((args) => args.startsWith('clone '))).toBe(true);
      expect(joined.some((args) => args.includes(' checkout '))).toBe(true);
      expect(joined.filter((args) => args.includes('remote get-url origin'))).toHaveLength(2);
      expect(gitCalls.filter((call) => call.options?.windowsHide !== true)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
