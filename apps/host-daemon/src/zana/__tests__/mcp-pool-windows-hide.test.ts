import { tmpdir } from 'node:os';
import { afterEach, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => [] as Array<{ fn: string; options: Record<string, unknown> }>);

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: (...args: Parameters<typeof actual.spawn>) => {
      calls.push({ fn: 'spawn', options: args[2] as Record<string, unknown> });
      return actual.spawn(...args);
    },
    execFileSync: (...args: Parameters<typeof actual.execFileSync>) => {
      calls.push({ fn: 'execFileSync', options: args[2] as Record<string, unknown> });
      return actual.execFileSync(...args);
    }
  };
});

const { resolveZanaMcpBin, spawnStdioServer } = await import('../mcp-pool.js');

afterEach(() => {
  calls.length = 0;
  vi.unstubAllEnvs();
});

function hidden() {
  return calls.map((call) => [call.fn, call.options.windowsHide]);
}

// The host daemon runs under Electron (a GUI process): on Windows a console
// child without windowsHide opens a visible console window.
it('spawns a stdio MCP server with the console window hidden', async () => {
  const server = { id: 'hide', label: 'hide', resolveBin: () => ({ bin: process.execPath, args: ['-e', ''] }) };
  const child = spawnStdioServer(server, tmpdir());
  const reason = await new Promise<string>((resolve) => child.onExit(resolve));
  expect(reason).toContain('code=0');
  expect(hidden()).toEqual([['spawn', true]]);
});

it('looks up the MCP server binary with the console window hidden', () => {
  vi.stubEnv('ZANA_MCP_BIN', '');
  // `which` may be missing (Windows) or not find the server; either way the
  // lookup goes through execFileSync and yields null or a path.
  const found = resolveZanaMcpBin();
  expect(found === null || typeof found.bin === 'string').toBe(true);
  expect(hidden()).toEqual([['execFileSync', true]]);
});
