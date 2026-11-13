import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAgentRuntimeWithAdapters, createFakeAdapter, fakeProviderScriptPath } from '@zana-ai/zcc-agent-runtime/test';

const registry = vi.hoisted(() => ({
  calls: [] as Array<string[] | undefined>,
  servers: { search: { name: 'plugin_acme_search', type: 'stdio', command: 'node' }, wiki: { name: 'plugin_acme_wiki', type: 'stdio', command: 'node' } } as Record<string, { name: string; type: string; command: string }>
}));
vi.mock('./mcp-config.js', async (orig) => ({
  ...(await orig<typeof import('./mcp-config.js')>()),
  // Mirrors the real contract: undefined = every always-on server; an array = exactly the covered ones.
  sessionPluginMcpServers: (names?: string[]) => {
    registry.calls.push(names);
    if (names === undefined) return Object.values(registry.servers);
    return Object.entries(registry.servers).filter(([key]) => names.includes(key)).map(([, def]) => def);
  }
}));

import { createAgentRuntimeAdapter, personaMcpAllowlist, personaScopedMcp } from './agent-runtime-adapter.js';

beforeEach(() => { registry.calls.length = 0; });

describe('personaMcpAllowlist', () => {
  it('reads only a string array, dropping non-strings and empties', () => {
    expect(personaMcpAllowlist(undefined)).toBeUndefined();
    expect(personaMcpAllowlist({})).toBeUndefined();
    expect(personaMcpAllowlist({ mcpAllowlist: 'search' })).toBeUndefined();
    expect(personaMcpAllowlist({ mcpAllowlist: ['search', 4, '', null] })).toEqual(['search']);
    expect(personaMcpAllowlist({ mcpAllowlist: [] })).toEqual([]);
  });
});

describe('personaScopedMcp', () => {
  it('no allowlist keeps the global behaviour byte-identical (all servers; none when automated)', () => {
    const opts = { skillAllowlist: ['x'] };
    const open = personaScopedMcp(opts, false);
    expect(open.mcpServers).toHaveLength(2);
    expect(open.providerOptions).toBe(opts);
    expect(personaScopedMcp(undefined, true)).toEqual({ mcpServers: [], providerOptions: undefined });
  });

  it('an allowlist narrows injected servers to exactly the covered ones and reports what it provides', () => {
    const out = personaScopedMcp({ mcpAllowlist: ['zcc-inbox', 'search', 'github'] }, false);
    expect(out.mcpServers.map((server) => server.name)).toEqual(['plugin_acme_search']);
    expect(out.providerOptions).toMatchObject({ mcpAllowlist: ['zcc-inbox', 'search', 'github'], mcpExternallyProvided: ['search'] });
  });

  it('an empty restriction injects nothing, never falling back to every server', () => {
    const out = personaScopedMcp({ mcpAllowlist: ['zcc-inbox'] }, false);
    expect(out.mcpServers).toEqual([]);
    expect(out.providerOptions?.mcpExternallyProvided).toEqual([]);
    expect(personaScopedMcp({ mcpAllowlist: [] }, false).mcpServers).toEqual([]);
  });

  it('an automated session injects none and provides none, but keeps the list for the isolated seed', () => {
    const out = personaScopedMcp({ mcpAllowlist: ['search'] }, true);
    expect(out.mcpServers).toEqual([]);
    expect(out.providerOptions).toMatchObject({ mcpAllowlist: ['search'], mcpExternallyProvided: [] });
  });
});

describe('adapter start/resume use the persona-scoped call', () => {
  let cwd: string;
  beforeEach(() => { cwd = mkdtempSync(join(tmpdir(), 'zcc-persona-mcp-')); });
  afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

  function build() {
    const startThread = vi.fn(async () => ({ providerThreadId: 'p' }));
    const resumeThread = vi.fn(async () => ({ providerThreadId: 'p' }));
    const adapter = createAgentRuntimeAdapter({
      emit: () => undefined,
      dataDir: cwd,
      createRuntime: (options) => {
        const runtime = createAgentRuntimeWithAdapters({ ...options, adapterFactory: () => createFakeAdapter({ scriptPath: fakeProviderScriptPath }) });
        vi.spyOn(runtime, 'startThread').mockImplementation(startThread as never);
        vi.spyOn(runtime, 'resumeThread').mockImplementation(resumeThread as never);
        return runtime;
      }
    });
    return { adapter, startThread, resumeThread };
  }
  const base = () => ({ threadId: randomUUID(), environmentId: randomUUID(), projectId: 'p1', providerId: 'fake', cwd });

  it('startWork with an allowlist injects only covered servers and forwards the externally-provided names', async () => {
    const { adapter, startThread } = build();
    try {
      await adapter.startWork({ ...base(), input: [], providerOptions: { mcpAllowlist: ['zcc-inbox', 'wiki'] } });
      const sent = startThread.mock.calls[0]![0] as { mcpServers?: Array<{ name: string }>; options: { providerOptions?: Record<string, unknown> } };
      expect(sent.mcpServers?.map((server) => server.name)).toEqual(['plugin_acme_wiki']);
      expect(sent.options.providerOptions).toMatchObject({ mcpAllowlist: ['zcc-inbox', 'wiki'], mcpExternallyProvided: ['wiki'] });
    } finally { adapter.dispose(); }
  });

  it('startWork without an allowlist keeps injecting every always-on server', async () => {
    const { adapter, startThread } = build();
    try {
      await adapter.startWork({ ...base(), input: [] });
      const sent = startThread.mock.calls[0]![0] as { mcpServers?: unknown[] };
      expect(sent.mcpServers).toHaveLength(2);
      expect(registry.calls).toContainEqual(undefined);
    } finally { adapter.dispose(); }
  });

  it('an empty-restriction start injects no plugin server at all', async () => {
    const { adapter, startThread } = build();
    try {
      await adapter.startWork({ ...base(), input: [], providerOptions: { mcpAllowlist: ['zcc-inbox'] } });
      expect(startThread.mock.calls[0]![0]).not.toHaveProperty('mcpServers');
    } finally { adapter.dispose(); }
  });

  it('resumeWork re-applies the persisted allowlist, and an automated resume injects nothing', async () => {
    const { adapter, resumeThread } = build();
    try {
      await adapter.resumeWork({ ...base(), providerThreadId: 'prov', providerOptions: { mcpAllowlist: ['zcc-inbox', 'search'] } } as never);
      const sent = resumeThread.mock.calls[0]![0] as { mcpServers?: Array<{ name: string }> };
      expect(sent.mcpServers?.map((server) => server.name)).toEqual(['plugin_acme_search']);
      await adapter.resumeWork({ ...base(), providerThreadId: 'prov', sessionKind: 'automated', providerOptions: { mcpAllowlist: ['search'] } } as never);
      const auto = resumeThread.mock.calls[1]![0] as { mcpServers?: unknown[]; options: { providerOptions?: Record<string, unknown> } };
      expect(auto.mcpServers).toBeUndefined();
      expect(auto.options.providerOptions).toMatchObject({ mcpAllowlist: ['search'], mcpExternallyProvided: [] });
    } finally { adapter.dispose(); }
  });
});
