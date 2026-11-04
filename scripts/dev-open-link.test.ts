import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildOpenLinkLaunch, validateLinkArg } from './dev-open-link.mjs';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('dev-open-link', () => {
  it('accepts dev and prod plugin links', () => {
    expect(validateLinkArg('zana-dev://plugin/design-docs/peer/join?d=abc')).toBeNull();
    expect(validateLinkArg('zana://plugin/a/b')).toBeNull();
  });

  it.each([undefined, '', 'https://plugin/a/b', 'zana-dev://other/a', 'evil://plugin/a/b', 'zana-dev://plugin/a/b c', `zana-dev://plugin/a/b?d=${'x'.repeat(9000)}`])(
    'rejects %s',
    (link) => {
      expect(validateLinkArg(link as string)).toEqual(expect.any(String));
    }
  );

  it('launches the dev entry with the link, the isolated dev data dir, and no E2E home', () => {
    const home = mkdtempSync(join(tmpdir(), 'zcc-open-link-'));
    dirs.push(home);
    const launch = buildOpenLinkLaunch('zana-dev://plugin/a/b', { HOME: home, ZCC_E2E_HOME: '/leak' }, '/electron');
    expect(launch.command).toBe('/electron');
    expect(launch.args[0]).toMatch(/out-dev\/main\/index\.js$/);
    expect(launch.args[1]).toBe('zana-dev://plugin/a/b');
    expect(launch.env.ZCC_DATA_DIR).toBe(join(home, '.zcc-dev'));
    expect(launch.env.ZCC_E2E_HOME).toBeUndefined();
  });
});

describe('dev-open-link CLI entry', () => {
  const scriptPath = fileURLToPath(new URL('./dev-open-link.mjs', import.meta.url));
  const originalArgv = process.argv;

  afterEach(() => {
    process.argv = originalArgv;
    vi.restoreAllMocks();
    vi.doUnmock('node:child_process');
    vi.resetModules();
  });

  async function runEntry(link: string | undefined) {
    const spawn = vi.fn(() => ({ on: vi.fn() }));
    vi.resetModules();
    vi.doMock('node:child_process', () => ({ spawn }));
    process.argv = [originalArgv[0], scriptPath, ...(link === undefined ? [] : [link])];
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await import('./dev-open-link.mjs');
    return { spawn, exit, stderr };
  }

  it('rejects a bad link with exit code 2 and a stderr message', async () => {
    const { exit, stderr } = await runEntry('https://nope');
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('link must look like'));
    expect(exit).toHaveBeenCalledWith(2);
  });

  it('spawns electron with the link and propagates the child exit code', async () => {
    const { spawn, exit } = await runEntry('zana-dev://plugin/a/b');
    expect(exit).not.toHaveBeenCalled();
    const [command, args, options] = spawn.mock.calls[0] as unknown as [string, string[], { stdio: string; env: Record<string, string> }];
    expect(typeof command).toBe('string');
    expect(args[1]).toBe('zana-dev://plugin/a/b');
    expect(options.stdio).toBe('inherit');
    const child = spawn.mock.results[0].value as { on: ReturnType<typeof vi.fn> };
    const onExit = child.on.mock.calls.find((call) => call[0] === 'exit')![1] as (code: number | null) => void;
    onExit(3);
    expect(exit).toHaveBeenLastCalledWith(3);
    onExit(null);
    expect(exit).toHaveBeenLastCalledWith(0);
  });
});
