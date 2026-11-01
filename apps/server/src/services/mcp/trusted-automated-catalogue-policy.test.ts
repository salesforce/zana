import { describe, expect, it } from 'vitest';
import { REMOTE_FS_TOOL_NAMES } from '@zana-ai/zcc-host-daemon/remote-fs-mcp-tools';
import { EXECUTION_MEMBER_TOOL_NAMES } from '../execution/execution-mcp-tool.js';
import { trustedAutomatedMcpCatalogue } from './trusted-automated-catalogue-policy.js';

describe('trustedAutomatedMcpCatalogue', () => {
  it.each(['worker', 'orchestrator'] as const)('selects only %s execution tools', (role) => {
    const catalogue = trustedAutomatedMcpCatalogue({ member: { role } });

    expect(catalogue).toMatchObject({ legacy: false, role });
    expect(catalogue.tools).toEqual(EXECUTION_MEMBER_TOOL_NAMES[role]);
  });

  it('adds remote file tools and remote_exec only for the trusted remote capability', () => {
    const catalogue = trustedAutomatedMcpCatalogue({
      member: { role: 'worker', capabilities: ['remote_fs'] }
    });

    expect(catalogue.tools).toEqual([
      ...EXECUTION_MEMBER_TOOL_NAMES.worker,
      ...REMOTE_FS_TOOL_NAMES,
      'remote_exec'
    ]);
  });

  it('rejects unknown host capabilities', () => {
    expect(() => trustedAutomatedMcpCatalogue({
      member: { role: 'worker', capabilities: ['shell'] }
    })).toThrow('Unknown trusted automated MCP capability: shell');
  });

  it('rejects unknown host roles', () => {
    expect(() => trustedAutomatedMcpCatalogue({
      member: { role: 'toString' }
    })).toThrow('Unknown trusted automated MCP role: toString');
  });

  it('returns an immutable, stable digest for the selected catalogue', () => {
    const first = trustedAutomatedMcpCatalogue({ member: { role: 'worker' } });
    const second = trustedAutomatedMcpCatalogue({ member: { role: 'worker' } });

    expect(first.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(first.digest).toBe(second.digest);
    expect(first.digest).not.toBe(trustedAutomatedMcpCatalogue({
      member: { role: 'worker', capabilities: ['remote_fs'] }
    }).digest);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.tools)).toBe(true);
    expect(() => (first.tools as string[]).push('forged')).toThrow();
    expect(first.digest).toBe(second.digest);
  });

  it('preserves legacy routes by returning no replacement tool catalogue', () => {
    const catalogue = trustedAutomatedMcpCatalogue({});

    expect(catalogue).toMatchObject({ legacy: true });
    expect(catalogue.tools).toBeUndefined();
  });
});
