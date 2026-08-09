/**
 * Unit tests for the host-managed MCP pool. A mock {@link StdioChild} stands in
 * for a real `zana-mcp-server`, so these exercise the JSON-RPC framing, the
 * workspace-confinement gate (Rules 1/2), graceful degradation, and lifecycle
 * (idle + dispose) with no real process.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  McpPool,
  McpUnavailableError,
  unwrapToolResult,
  type McpServerDef,
  type StdioChild
} from '../mcp-pool.js';

/** A scriptable in-memory stdio child: reads frames, auto-answers by method. */
function makeMockChild(handlers: {
  onInitialize?: () => unknown;
  onCall?: (name: string, args: Record<string, unknown>) => unknown;
  toolError?: string;
}): { child: StdioChild; killed: () => boolean; frames: unknown[] } {
  let lineCb: ((line: string) => void) | null = null;
  let killed = false;
  const frames: unknown[] = [];
  const reply = (obj: unknown) => lineCb?.(JSON.stringify(obj));
  const child: StdioChild = {
    write(frame: string) {
      const msg = JSON.parse(frame) as { id?: number; method: string; params: any };
      frames.push(msg);
      if (msg.id === undefined) return; // notification — no reply
      if (msg.method === 'initialize') {
        reply({ jsonrpc: '2.0', id: msg.id, result: handlers.onInitialize?.() ?? { protocolVersion: '2024-11-05' } });
      } else if (msg.method === 'tools/call') {
        const out = handlers.onCall?.(msg.params.name, msg.params.arguments) ?? {};
        const text = typeof out === 'string' ? out : JSON.stringify(out);
        reply({
          jsonrpc: '2.0',
          id: msg.id,
          result: { content: [{ type: 'text', text }], isError: !!handlers.toolError }
        });
      }
    },
    onLine(cb) {
      lineCb = cb;
    },
    onExit() {},
    kill() {
      killed = true;
    }
  };
  return { child, killed: () => killed, frames };
}

const WS = '/repo/proj';

function zanaDef(overrides: Partial<McpServerDef> = {}): McpServerDef {
  return {
    id: 'zana',
    label: 'zana',
    resolveBin: () => ({ bin: '/fake/zana-mcp-server', args: [] }),
    ...overrides
  };
}

describe('McpPool', () => {
  it('handshakes once then routes tools/call, unwrapping the JSON envelope', async () => {
    const { child, frames } = makeMockChild({
      onCall: (name) => (name === 'zana_ticket_list' ? [{ id: 't1' }] : {})
    });
    const pool = new McpPool({
      servers: [zanaDef()],
      resolveWorkspace: () => WS,
      log: () => {},
      spawn: () => child
    });
    const result = await pool.call('zana', 'zana_ticket_list', {}, { projectPath: WS });
    expect(result).toEqual([{ id: 't1' }]);
    // initialize + notifications/initialized + tools/call — handshake ran once.
    const methods = (frames as Array<{ method: string }>).map((f) => f.method);
    expect(methods).toEqual(['initialize', 'notifications/initialized', 'tools/call']);

    // A second call reuses the SAME child (no re-handshake).
    await pool.call('zana', 'zana_ticket_list', {}, { projectPath: WS });
    const methods2 = (frames as Array<{ method: string }>).map((f) => f.method);
    expect(methods2.filter((m) => m === 'initialize')).toHaveLength(1);
    expect(pool.size()).toBe(1);
    pool.disposeAll();
  });

  it('rejects with McpUnavailableError when the workspace is not authorized (Rule 1/2)', async () => {
    const spawn = vi.fn(() => makeMockChild({}).child);
    const pool = new McpPool({
      servers: [zanaDef()],
      resolveWorkspace: () => {
        throw new Error('not within any registered project');
      },
      log: () => {},
      spawn
    });
    await expect(pool.call('zana', 'zana_ticket_list', {}, { projectPath: '/etc' })).rejects.toBeInstanceOf(
      McpUnavailableError
    );
    // Never spawned a child for an unauthorized path.
    expect(spawn).not.toHaveBeenCalled();
  });

  it('degrades to McpUnavailableError when the bin is not installed', async () => {
    const pool = new McpPool({
      servers: [zanaDef({ resolveBin: () => null })],
      resolveWorkspace: () => WS,
      log: () => {},
      spawn: () => {
        throw new Error('should not spawn');
      }
    });
    await expect(pool.call('zana', 'zana_ticket_list', {}, { useGlobal: true })).rejects.toBeInstanceOf(
      McpUnavailableError
    );
    expect(pool.size()).toBe(0);
  });

  it('rejects an unknown server id', async () => {
    const pool = new McpPool({ servers: [zanaDef()], resolveWorkspace: () => WS, log: () => {} });
    await expect(pool.call('nope', 'x', {}, { useGlobal: true })).rejects.toBeInstanceOf(McpUnavailableError);
  });

  it('disposeAll kills live children and refuses further calls', async () => {
    const mock = makeMockChild({});
    const pool = new McpPool({
      servers: [zanaDef()],
      resolveWorkspace: () => WS,
      log: () => {},
      spawn: () => mock.child
    });
    await pool.call('zana', 'zana_ticket_list', {}, { projectPath: WS });
    expect(pool.size()).toBe(1);
    pool.disposeAll();
    expect(mock.killed()).toBe(true);
    expect(pool.size()).toBe(0);
    await expect(pool.call('zana', 'x', {}, { useGlobal: true })).rejects.toBeInstanceOf(McpUnavailableError);
  });
});

describe('McpPool.initWorkspace', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });

  it('creates .zana/ + subdirs + config.json for a fresh workspace', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'zana-init-'));
    dirs.push(workspace);
    const pool = new McpPool({ servers: [zanaDef()], resolveWorkspace: () => workspace, log: () => {} });

    const result = await pool.initWorkspace({ projectPath: workspace });
    expect(result).toEqual({ created: true });

    const zanaDir = join(workspace, '.zana');
    for (const d of ['tickets', 'sprints', 'artifacts', 'plans', 'audit', 'sessions', 'runs', 'events', 'scheduler', 'tmp']) {
      expect(existsSync(join(zanaDir, d))).toBe(true);
    }
    const config = JSON.parse(await readFile(join(zanaDir, 'config.json'), 'utf-8'));
    expect(config).toMatchObject({ version: 1, createdBy: 'zcc-init' });
  });

  it('is idempotent: a second call on an already-initialized workspace is a no-op', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'zana-init-'));
    dirs.push(workspace);
    const pool = new McpPool({ servers: [zanaDef()], resolveWorkspace: () => workspace, log: () => {} });

    await pool.initWorkspace({ projectPath: workspace });
    const configPath = join(workspace, '.zana', 'config.json');
    const before = await readFile(configPath, 'utf-8');

    const second = await pool.initWorkspace({ projectPath: workspace });
    expect(second).toEqual({ created: false });
    const after = await readFile(configPath, 'utf-8');
    expect(after).toBe(before); // config.json untouched, not rewritten
  });

  it('fills in missing subdirs for a partially-initialized workspace (self-healed tickets/sprints)', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'zana-init-'));
    dirs.push(workspace);
    // Simulate the self-healed state: tickets/sprints exist, config.json + others don't.
    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(workspace, '.zana', 'tickets'), { recursive: true });
    await mkdir(join(workspace, '.zana', 'sprints'), { recursive: true });

    const pool = new McpPool({ servers: [zanaDef()], resolveWorkspace: () => workspace, log: () => {} });
    const result = await pool.initWorkspace({ projectPath: workspace });
    expect(result).toEqual({ created: true });
    expect(existsSync(join(workspace, '.zana', 'plans'))).toBe(true);
    expect(existsSync(join(workspace, '.zana', 'config.json'))).toBe(true);
  });

  it('rejects with McpUnavailableError when the workspace is not authorized (Rule 1/2)', async () => {
    const pool = new McpPool({
      servers: [zanaDef()],
      resolveWorkspace: () => {
        throw new Error('not within any registered project');
      },
      log: () => {}
    });
    await expect(pool.initWorkspace({ projectPath: '/etc' })).rejects.toBeInstanceOf(McpUnavailableError);
  });
});

describe('McpPool.isWorkspaceInitialized', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });

  it('resolves false for a workspace with no .zana/ directory', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'zana-isinit-'));
    dirs.push(workspace);
    const pool = new McpPool({ servers: [zanaDef()], resolveWorkspace: () => workspace, log: () => {} });
    expect(await pool.isWorkspaceInitialized({ projectPath: workspace })).toBe(false);
  });

  it('resolves true once initWorkspace has completed the .zana/ scaffold', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'zana-isinit-'));
    dirs.push(workspace);
    const pool = new McpPool({ servers: [zanaDef()], resolveWorkspace: () => workspace, log: () => {} });
    expect(await pool.isWorkspaceInitialized({ projectPath: workspace })).toBe(false);
    await pool.initWorkspace({ projectPath: workspace });
    expect(await pool.isWorkspaceInitialized({ projectPath: workspace })).toBe(true);
  });

  it('resolves false for a partially-initialized workspace (missing config.json or a subdir)', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'zana-isinit-'));
    dirs.push(workspace);
    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(workspace, '.zana', 'tickets'), { recursive: true });
    const pool = new McpPool({ servers: [zanaDef()], resolveWorkspace: () => workspace, log: () => {} });
    expect(await pool.isWorkspaceInitialized({ projectPath: workspace })).toBe(false);
  });

  it('resolves false (never throws) when the workspace is not authorized (Rule 1/2)', async () => {
    const pool = new McpPool({
      servers: [zanaDef()],
      resolveWorkspace: () => {
        throw new Error('not within any registered project');
      },
      log: () => {}
    });
    await expect(pool.isWorkspaceInitialized({ projectPath: '/etc' })).resolves.toBe(false);
  });

  it('resolves false once the pool has been disposed', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'zana-isinit-'));
    dirs.push(workspace);
    const pool = new McpPool({ servers: [zanaDef()], resolveWorkspace: () => workspace, log: () => {} });
    await pool.initWorkspace({ projectPath: workspace });
    pool.disposeAll();
    expect(await pool.isWorkspaceInitialized({ projectPath: workspace })).toBe(false);
  });
});

describe('unwrapToolResult', () => {
  it('parses JSON text content', () => {
    expect(unwrapToolResult({ content: [{ type: 'text', text: '{"a":1}' }] })).toEqual({ a: 1 });
  });
  it('returns null for empty text', () => {
    expect(unwrapToolResult({ content: [{ type: 'text', text: '' }] })).toBeNull();
  });
  it('returns the raw string when text is not JSON', () => {
    expect(unwrapToolResult({ content: [{ type: 'text', text: 'hello' }] })).toBe('hello');
  });
  it('throws when isError is set', () => {
    expect(() => unwrapToolResult({ content: [{ type: 'text', text: 'boom' }], isError: true })).toThrow('boom');
  });
});
