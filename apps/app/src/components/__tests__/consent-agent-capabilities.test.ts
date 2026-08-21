import { describe, it, expect } from 'vitest';
import type { ExtensionEntry } from '@zana-ai/zcc-domain/product';
import { agentCapabilityLines, pluginCapabilityLines, PERMISSION_LABELS } from '../ExtensionConsent.js';

/**
 * docs/extension-agent-capabilities-plan.md §8 — the consent screen must name
 * the CONCRETE skills/MCP servers an `agent:contribute` grant would add, not
 * just the bare permission token. Pure-function assertion over the entry (no
 * React render), mirroring consent-scope-lines.test.ts's shape.
 */
function entryWithAgentCapabilities(opts: {
  permissions?: string[];
  skills?: Array<{ path: string; slug?: string }>;
  mcpServers?: Array<{ name: string; alwaysOn?: boolean }>;
}): ExtensionEntry {
  return {
    manifest: {
      permissions: opts.permissions ?? ['agent:contribute'],
      skills: opts.skills,
      mcpServers: opts.mcpServers
    }
  } as unknown as ExtensionEntry;
}

describe('ExtensionConsent agentCapabilityLines', () => {
  it('lists declared skill slugs', () => {
    const lines = agentCapabilityLines(
      entryWithAgentCapabilities({ skills: [{ path: 'skills/foo.md', slug: 'foo' }, { path: 'bar.md' }] })
    );
    expect(lines).toContain('Skills it adds: foo, bar.md');
  });

  it('lists declared MCP server names, flagging alwaysOn ones', () => {
    const lines = agentCapabilityLines(
      entryWithAgentCapabilities({
        mcpServers: [{ name: 'acme-tools', alwaysOn: true }, { name: 'acme-remote' }]
      })
    );
    expect(lines).toContain('Integration servers it adds: acme-tools (always on), acme-remote');
  });

  it('emits nothing when the manifest does not declare agent:contribute', () => {
    const lines = agentCapabilityLines(
      entryWithAgentCapabilities({
        permissions: [],
        skills: [{ path: 'foo.md' }],
        mcpServers: [{ name: 'srv' }]
      })
    );
    expect(lines).toEqual([]);
  });

  it('emits nothing when agent:contribute is declared but no skills/servers are', () => {
    expect(agentCapabilityLines(entryWithAgentCapabilities({}))).toEqual([]);
    expect(agentCapabilityLines({ manifest: {} } as unknown as ExtensionEntry)).toEqual([]);
  });

  it('has a plain-language label for agent:contribute, marked loud (⚠)', () => {
    expect(PERMISSION_LABELS['agent:contribute']).toMatch(/^⚠/);
  });
});

describe('pluginCapabilityLines', () => {
  it('lists skills, always-on MCP, and extra string values without a permission gate', () => {
    expect(
      pluginCapabilityLines({
        skillNames: ['hello'],
        mcpServers: [{ name: 'library', alwaysOn: true }],
        extra: { notes: 'Host MCP library_search', commands: ['./commands'] }
      })
    ).toEqual([
      'Skills it adds: hello',
      'Integration servers it adds: library (always on)',
      'Also: notes: Host MCP library_search',
      'Also: commands'
    ]);
  });
});
