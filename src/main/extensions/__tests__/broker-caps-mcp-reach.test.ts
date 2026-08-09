/**
 * W1-2 VERIFY step: prove a disk-tier extension with `mcp` permission +
 * `mcpAllowlist: ['zana']` reaches `ctx.mcp('zana', tool, ...)` via the broker,
 * and a disk ext without the grant is denied. This is an e2e-ish layer test —
 * it instantiates the broker + mock MCP pool, passes a broker request through
 * the gated performer, and verifies the allowlist enforcement BEFORE any real
 * pool call is attempted.
 */

import { describe, it, expect } from 'vitest';
import { PermissionBroker, grantFromManifest } from '../permission-broker.js';
import type { BrokerCapabilities } from '../process-host.js';

/** Minimal mock MCP pool: records the call args, returns a canned result. */
class MockMcpPool {
  public calls: Array<{
    serverId: string;
    tool: string;
    args?: Record<string, unknown>;
    opts?: { projectPath?: string; useGlobal?: boolean };
  }> = [];

  async call(
    serverId: string,
    tool: string,
    args?: Record<string, unknown>,
    opts?: { projectPath?: string; useGlobal?: boolean }
  ): Promise<unknown> {
    this.calls.push({ serverId, tool, args, opts });
    return { mock: 'result' };
  }
}

/**
 * Build the brokered `mcp` capability (from broker-caps.ts), injecting the mock
 * pool. The real broker-caps checks the permission via `broker.assert(moduleId,
 * 'mcp', { kind: 'mcp', serverId })` BEFORE calling the pool — we verify that
 * gate fires correctly.
 */
function createMcpCapability(broker: PermissionBroker, pool: MockMcpPool): BrokerCapabilities['mcp'] {
  return async (
    moduleId: string,
    serverId: string,
    tool: string,
    args?: Record<string, unknown>,
    opts?: { projectPath?: string; useGlobal?: boolean }
  ) => {
    // Mirror broker-caps.ts `mcp` cap implementation (lines ~170-180):
    // assert the permission + scope BEFORE touching the pool.
    broker.assert(moduleId, 'mcp', { kind: 'mcp', serverId });
    return pool.call(serverId, tool, args, opts);
  };
}

describe('broker-caps-mcp-reach — disk ext ctx.mcp gate (W1-2)', () => {
  it('allows a disk ext with mcp permission + zana in mcpAllowlist to reach ctx.mcp("zana", ...)', async () => {
    const broker = new PermissionBroker({
      builtinIds: new Set(['slack']),
      grants: (id) => {
        if (id === 'alpha') {
          return grantFromManifest(
            ['mcp'], // the permission token
            { mcpAllowlist: ['zana'] }, // the scope allowlist
            '/fake/alpha-ext-dir'
          );
        }
        return null;
      }
    });
    const pool = new MockMcpPool();
    const mcpCap = createMcpCapability(broker, pool);

    // ACT: alpha calls ctx.mcp('zana', 'zana_ticket_get', { id: 'T-1' })
    const result = await mcpCap('alpha', 'zana', 'zana_ticket_get', { id: 'T-1' });

    // ASSERT: the call reached the pool (gated performer allowed it)
    expect(pool.calls).toHaveLength(1);
    expect(pool.calls[0]).toEqual({
      serverId: 'zana',
      tool: 'zana_ticket_get',
      args: { id: 'T-1' },
      opts: undefined
    });
    expect(result).toEqual({ mock: 'result' });
  });

  it('denies a disk ext without mcp permission', async () => {
    const broker = new PermissionBroker({
      builtinIds: new Set(['slack']),
      grants: (id) => {
        if (id === 'beta') {
          // beta has no mcp permission, but has storage
          return grantFromManifest(['storage'], undefined, '/fake/beta-ext-dir');
        }
        return null;
      }
    });
    const pool = new MockMcpPool();
    const mcpCap = createMcpCapability(broker, pool);

    // ACT + ASSERT: beta calls ctx.mcp('zana', 'zana_ticket_get') → denied
    await expect(mcpCap('beta', 'zana', 'zana_ticket_get')).rejects.toThrow(/PermissionDenied/);
    await expect(mcpCap('beta', 'zana', 'zana_ticket_get')).rejects.toThrow(/lacks "mcp"/);
    // The pool was never touched (gate rejected before the call)
    expect(pool.calls).toHaveLength(0);
  });

  it('denies a disk ext with mcp permission but zana NOT in mcpAllowlist', async () => {
    const broker = new PermissionBroker({
      builtinIds: new Set(['slack']),
      grants: (id) => {
        if (id === 'gamma') {
          // gamma has mcp permission but only 'other-server' in the allowlist
          return grantFromManifest(['mcp'], { mcpAllowlist: ['other-server'] }, '/fake/gamma-ext-dir');
        }
        return null;
      }
    });
    const pool = new MockMcpPool();
    const mcpCap = createMcpCapability(broker, pool);

    // ACT + ASSERT: gamma calls ctx.mcp('zana', ...) → denied (zana not in allowlist)
    await expect(mcpCap('gamma', 'zana', 'zana_ticket_get')).rejects.toThrow(/PermissionDenied/);
    await expect(mcpCap('gamma', 'zana', 'zana_ticket_get')).rejects.toThrow(/server=zana/);
    // The pool was never touched
    expect(pool.calls).toHaveLength(0);
  });

  it('allows a disk ext with mcp permission + wildcard mcpAllowlist to reach any server', async () => {
    const broker = new PermissionBroker({
      builtinIds: new Set(['slack']),
      grants: (id) => {
        if (id === 'delta') {
          // delta has mcp permission + '*' allowlist (any server)
          return grantFromManifest(['mcp'], { mcpAllowlist: ['*'] }, '/fake/delta-ext-dir');
        }
        return null;
      }
    });
    const pool = new MockMcpPool();
    const mcpCap = createMcpCapability(broker, pool);

    // ACT: delta calls ctx.mcp('zana', ...) and ctx.mcp('other-server', ...)
    await mcpCap('delta', 'zana', 'zana_ticket_get', { id: 'T-2' });
    await mcpCap('delta', 'other-server', 'some_tool');

    // ASSERT: both reached the pool (wildcard allowed them)
    expect(pool.calls).toHaveLength(2);
    expect(pool.calls[0].serverId).toBe('zana');
    expect(pool.calls[1].serverId).toBe('other-server');
  });

  it('allows a built-in module to reach ctx.mcp without any declared grant (provenance trust)', async () => {
    const broker = new PermissionBroker({
      builtinIds: new Set(['slack']), // slack is built-in (trusted by provenance)
      grants: (id) => null // no grants provider (built-ins bypass it)
    });
    const pool = new MockMcpPool();
    const mcpCap = createMcpCapability(broker, pool);

    // ACT: slack (built-in) calls ctx.mcp('zana', ...) — no declared permission
    const result = await mcpCap('slack', 'zana', 'zana_ticket_get', { id: 'T-3' });

    // ASSERT: built-in bypasses the grant check, reaches the pool
    expect(pool.calls).toHaveLength(1);
    expect(pool.calls[0].serverId).toBe('zana');
    expect(result).toEqual({ mock: 'result' });
  });
});
