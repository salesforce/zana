import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// mcp-config derives its dir from os.homedir() at import time. Point homedir
// at a throwaway dir so the test writes there, not the real ~/.zcc.
const fakeHome = mkdtempSync(join(tmpdir(), 'cc-mcp-home-'));
vi.mock('node:os', async (orig) => {
  const actual = await orig<typeof import('node:os')>();
  return { ...actual, homedir: () => fakeHome };
});

let mod: typeof import('../mcp-config.js');

beforeAll(async () => {
  mod = await import('../mcp-config.js');
});

afterAll(() => {
  rmSync(fakeHome, { recursive: true, force: true });
});

describe('ensureMcpConfigForProjectSync', () => {
  it('writes a .mcp.json at the per-project path', () => {
    const path = mod.ensureMcpConfigForProjectSync('proj-abc');
    expect(path).toBe(mod.mcpConfigPathForProject('proj-abc'));
    expect(existsSync(path)).toBe(true);
  });

  it('writes the zcc-inbox server with the literal ${ZCC_MCP_URL} placeholder', () => {
    const path = mod.ensureMcpConfigForProjectSync('proj-xyz');
    const body = JSON.parse(readFileSync(path, 'utf8'));
    expect(body.mcpServers['zcc-inbox']).toEqual({
      type: 'streamable-http',
      url: '${ZCC_MCP_URL}'
    });
  });

  it('is idempotent — repeated calls leave one valid file', () => {
    const a = mod.ensureMcpConfigForProjectSync('proj-idem');
    const b = mod.ensureMcpConfigForProjectSync('proj-idem');
    expect(a).toBe(b);
    expect(() => JSON.parse(readFileSync(a, 'utf8'))).not.toThrow();
  });

  it('does not leave a .tmp file behind after the atomic rename', () => {
    mod.ensureMcpConfigForProjectSync('proj-tmp');
    const dir = join(fakeHome, '.zcc', 'mcp');
    const leftovers = readdirSync(dir).filter((f) => f.includes('.tmp-'));
    expect(leftovers).toEqual([]);
  });

  it('produces byte-identical output to the async writer', async () => {
    const syncPath = mod.ensureMcpConfigForProjectSync('proj-parity-sync');
    const asyncPath = await mod.ensureMcpConfigForProject('proj-parity-async');
    expect(readFileSync(syncPath, 'utf8')).toBe(readFileSync(asyncPath, 'utf8'));
  });
});

// Regression (QA low #6): the async ensureMcpConfigForProject used Date.now()
// for tmp uniqueness, so two concurrent writes for the same project within the
// same millisecond could collide on the tmp path (one write's rename pulls the
// file out from under the other). The sync twin already used randomUUID; this
// aligns the async one. Assert concurrent writes converge to one valid file with
// no tmp leftovers.
describe('ensureMcpConfigForProject — concurrent writes (async)', () => {
  it('several concurrent writes for one project leave a single valid file, no tmp leak', async () => {
    const id = 'proj-concurrent';
    await Promise.all(Array.from({ length: 8 }, () => mod.ensureMcpConfigForProject(id)));
    const path = mod.mcpConfigPathForProject(id);
    // The final file parses cleanly (no write was left half-renamed / clobbered).
    expect(() => JSON.parse(readFileSync(path, 'utf8'))).not.toThrow();
    const dir = join(fakeHome, '.zcc', 'mcp');
    const leftovers = readdirSync(dir).filter((f) => f.includes(`${id}.json.tmp-`));
    expect(leftovers).toEqual([]);
  });
});

// docs/extension-agent-capabilities-plan.md §5/§7 — extension-contributed servers.
describe('rebuildExtensionServers', () => {
  afterAll(() => {
    // Leave the module-scoped registry empty for any later-loaded test file
    // that imports this same module instance.
    mod.rebuildExtensionServers([]);
  });

  it('ignores an extension without agent:contribute, even if enabled + consented', () => {
    mod.rebuildExtensionServers([
      {
        id: 'acme.noperm',
        enabled: true,
        consented: true,
        manifest: {
          permissions: [],
          mcpServers: [{ name: 'srv', type: 'stdio', command: 'acme-bin' }]
        }
      }
    ]);
    const body = JSON.parse(mod.ensureMcpConfigForProjectSync('proj-noperm') && readFileSync(
      mod.mcpConfigPathForProject('proj-noperm'),
      'utf8'
    ));
    expect(body.mcpServers['ext:acme.noperm:srv']).toBeUndefined();
  });

  it('ignores a disabled or unconsented extension even with agent:contribute declared', () => {
    mod.rebuildExtensionServers([
      {
        id: 'acme.disabled',
        enabled: false,
        consented: true,
        manifest: {
          permissions: ['agent:contribute'],
          mcpServers: [{ name: 'srv', type: 'stdio', command: 'acme-bin' }]
        }
      },
      {
        id: 'acme.unconsented',
        enabled: true,
        consented: false,
        manifest: {
          permissions: ['agent:contribute'],
          mcpServers: [{ name: 'srv', type: 'stdio', command: 'acme-bin' }]
        }
      }
    ]);
    const path = mod.ensureMcpConfigForProjectSync('proj-gated', [
      'ext:acme.disabled:srv',
      'ext:acme.unconsented:srv'
    ]);
    const body = JSON.parse(readFileSync(path, 'utf8'));
    expect(body.mcpServers['ext:acme.disabled:srv']).toBeUndefined();
    expect(body.mcpServers['ext:acme.unconsented:srv']).toBeUndefined();
  });

  it('registers a namespaced server for an enabled+consented extension declaring agent:contribute, resolved by extraServerNames', () => {
    mod.rebuildExtensionServers([
      {
        id: 'acme.tools',
        enabled: true,
        consented: true,
        manifest: {
          permissions: ['agent:contribute'],
          mcpServers: [
            { name: 'acme-tools', type: 'stdio', command: 'acme-mcp-server', args: ['--port', '0'] }
          ]
        }
      }
    ]);
    const path = mod.ensureMcpConfigForProjectSync('proj-named', ['ext:acme.tools:acme-tools']);
    const body = JSON.parse(readFileSync(path, 'utf8'));
    expect(body.mcpServers['ext:acme.tools:acme-tools']).toEqual({
      type: 'stdio',
      command: 'acme-mcp-server',
      args: ['--port', '0']
    });
  });

  it('drops a stdio server whose command is not a bare basename (path traversal / shell string)', () => {
    mod.rebuildExtensionServers([
      {
        id: 'acme.evil',
        enabled: true,
        consented: true,
        manifest: {
          permissions: ['agent:contribute'],
          mcpServers: [
            { name: 'evil', type: 'stdio', command: '../../usr/bin/curl' },
            { name: 'evil2', type: 'stdio', command: 'sh -c "rm -rf /"' }
          ]
        }
      }
    ]);
    const path = mod.ensureMcpConfigForProjectSync('proj-evil', ['ext:acme.evil:evil', 'ext:acme.evil:evil2']);
    const body = JSON.parse(readFileSync(path, 'utf8'));
    expect(body.mcpServers['ext:acme.evil:evil']).toBeUndefined();
    expect(body.mcpServers['ext:acme.evil:evil2']).toBeUndefined();
  });

  it('merges an alwaysOn extension server into every project unconditionally, without being named', () => {
    mod.rebuildExtensionServers([
      {
        id: 'acme.always',
        enabled: true,
        consented: true,
        manifest: {
          permissions: ['agent:contribute'],
          mcpServers: [{ name: 'watcher', type: 'stdio', command: 'acme-watcher', alwaysOn: true }]
        }
      }
    ]);
    // No extraServerNames passed at all — alwaysOn must still apply.
    const path = mod.ensureMcpConfigForProjectSync('proj-alwayson');
    const body = JSON.parse(readFileSync(path, 'utf8'));
    expect(body.mcpServers['ext:acme.always:watcher']).toEqual({
      type: 'stdio',
      command: 'acme-watcher'
    });
  });

  it('is a declarative replace — a server from a previous call disappears once rebuilt without it', () => {
    mod.rebuildExtensionServers([
      {
        id: 'acme.once',
        enabled: true,
        consented: true,
        manifest: {
          permissions: ['agent:contribute'],
          mcpServers: [{ name: 'srv', type: 'stdio', command: 'once-bin', alwaysOn: true }]
        }
      }
    ]);
    const firstPath = mod.ensureMcpConfigForProjectSync('proj-replace');
    expect(JSON.parse(readFileSync(firstPath, 'utf8')).mcpServers['ext:acme.once:srv']).toBeDefined();

    mod.rebuildExtensionServers([]); // extension uninstalled/disabled
    const secondPath = mod.ensureMcpConfigForProjectSync('proj-replace');
    expect(JSON.parse(readFileSync(secondPath, 'utf8')).mcpServers['ext:acme.once:srv']).toBeUndefined();
  });

  it('never throws on a malformed contributor and still applies the well-formed ones', () => {
    expect(() =>
      mod.rebuildExtensionServers([
        // @ts-expect-error deliberately malformed for the resilience assertion
        { id: 'acme.bad', enabled: true, consented: true, manifest: { permissions: ['agent:contribute'], mcpServers: 'not-an-array' } },
        {
          id: 'acme.good',
          enabled: true,
          consented: true,
          manifest: {
            permissions: ['agent:contribute'],
            mcpServers: [{ name: 'srv', type: 'stdio', command: 'good-bin', alwaysOn: true }]
          }
        }
      ])
    ).not.toThrow();
    const path = mod.ensureMcpConfigForProjectSync('proj-resilient');
    const body = JSON.parse(readFileSync(path, 'utf8'));
    expect(body.mcpServers['ext:acme.good:srv']).toBeDefined();
  });
});
