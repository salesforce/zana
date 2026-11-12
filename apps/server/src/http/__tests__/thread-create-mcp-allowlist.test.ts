import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

const patch = vi.hoisted(() => ({ calls: [] as unknown[], ok: true, events: [] as unknown[], appendThrows: false }));
vi.mock('@zana-ai/zcc-db', async (orig) => ({
  ...(await orig<typeof import('@zana-ai/zcc-db')>()),
  appendConversationThreadEvent: (_db: unknown, input: { threadId: string; type: string; payload: unknown }) => {
    if (patch.appendThrows) throw new Error('db down');
    patch.events.push(input);
    return { threadId: input.threadId, sequence: 3, type: input.type, payload: input.payload };
  },
  patchThreadPluginMetadata: (_db: unknown, input: unknown) => { patch.calls.push(input); return { ok: patch.ok }; }
}));

import {
  emitPersonaMcpNotice, emitPersonaNotice, personaMcpAllowlistLaunchNotice, personaThreadMcpFields, persistThreadSkillSelection
} from '../thread-create.js';
import { PERSONA_MCP_ALLOWLIST_OPERATION, personaMcpAllowlistNotice, resolveModernMcpAllowlist } from '../../services/threads/persona-mcp-allowlist.js';

const dataDir = mkdtempSync(join(tmpdir(), 'zcc-persona-mcp-'));
mkdirSync(join(dataDir, 'personas'));
const write = (id: string, extra: object) =>
  writeFileSync(join(dataDir, 'personas', `${id}.json`), JSON.stringify({ id, name: id, baseProfile: 'claude', ...extra }));
write('open', {});
write('some', { mcpServers: ['github', 'plugin:acme:search'] });
write('none', { mcpServers: [] });
afterAll(() => rmSync(dataDir, { recursive: true, force: true }));
const ctx = { dataDir } as never;
const local = { path: '/nowhere' } as never;
const remote = { path: '/nowhere', remote: { hostId: 'h' } } as never;

describe('resolveModernMcpAllowlist', () => {
  it('is undefined when unset or malformed, and always includes zcc-inbox when set', () => {
    expect(resolveModernMcpAllowlist(undefined)).toBeUndefined();
    expect(resolveModernMcpAllowlist({})).toBeUndefined();
    expect(resolveModernMcpAllowlist({ mcpServers: 'github' as never })).toBeUndefined();
    expect(resolveModernMcpAllowlist({ mcpServers: ['github'] })).toEqual(expect.arrayContaining(['github', 'zcc-inbox']));
  });

  it('keeps an empty list restricted to zcc-inbox only', () => {
    expect(resolveModernMcpAllowlist({ mcpServers: [] })).toEqual(['zcc-inbox']);
  });
});

describe('personaThreadMcpFields', () => {
  it('is empty without a persona, for unknown and for unrestricted personas', () => {
    expect(personaThreadMcpFields(ctx)).toEqual({});
    expect(personaThreadMcpFields(ctx, 'missing', local)).toEqual({});
    expect(personaThreadMcpFields(ctx, 'open', local)).toEqual({});
  });

  it('carries the main-resolved list in providerOptions.mcpAllowlist', () => {
    const out = personaThreadMcpFields(ctx, 'some', local);
    expect(out.mcpAllowlist).toEqual(expect.arrayContaining(['github', 'plugin:acme:search', 'zcc-inbox']));
    expect(out.providerOptions).toEqual({ mcpAllowlist: out.mcpAllowlist });
  });

  it('an empty persona list still restricts', () => {
    expect(personaThreadMcpFields(ctx, 'none', local).providerOptions).toEqual({ mcpAllowlist: ['zcc-inbox'] });
  });

  it('built-in personas carry no MCP list; ext: personas are unresolvable', () => {
    expect(personaThreadMcpFields(ctx, 'builtin:reviewer', remote)).toEqual({});
    expect(personaThreadMcpFields(ctx, 'ext:acme/p', local)).toEqual({});
  });

  it('thread.start takes the list from the persona store, never from the request input', () => {
    const source = readFileSync(new URL('../thread-create.ts', import.meta.url), 'utf8');
    expect(source).toContain('personaThreadMcpFields(ctx, args.input.personaId, args.project)');
    expect(source).not.toMatch(/args\.input\.(mcpAllowlist|mcpServers)/);
  });
});

describe('persona MCP allowlist notice', () => {
  const base = { allowlist: ['zcc-inbox', 'github'], personaLabel: 'p' };

  it('states the limit on a non-isolated or non-Claude launch (ACP is additive)', () => {
    const text = personaMcpAllowlistNotice({ ...base, providerId: 'acp-cursor', isolated: false });
    expect(text).toContain('github');
    expect(text).not.toContain('zcc-inbox');
    expect(text).toMatch(/only the plugin servers Zana injects/);
    expect(text).toMatch(/stay available/);
    expect(personaMcpAllowlistNotice({ ...base, providerId: 'claude-code', isolated: false })).toMatch(/only the plugin servers Zana injects/);
  });

  it('names the broader Claude user-config limit for an isolated Claude session', () => {
    const text = personaMcpAllowlistNotice({ ...base, providerId: 'claude-code', isolated: true });
    expect(text).toMatch(/Claude user-config servers/);
    expect(text).toMatch(/project-scope servers are not filtered/);
  });

  it('says "no extra servers" for an empty list and falls back to a generic subject', () => {
    const text = personaMcpAllowlistNotice({ providerId: 'claude', isolated: true, allowlist: ['zcc-inbox'] });
    expect(text).toMatch(/^The persona restricts MCP servers to: no extra servers/);
  });

  it('launch notice: absent for unrestricted, a "could not be applied" warning for ext:/remote-unknown', () => {
    expect(personaMcpAllowlistLaunchNotice(ctx, { personaId: 'open', providerId: 'claude-code' }, local)).toBeUndefined();
    expect(personaMcpAllowlistLaunchNotice(ctx, { providerId: 'claude-code' }, local)).toBeUndefined();
    expect(personaMcpAllowlistLaunchNotice(ctx, { personaId: 'ext:acme/p', providerId: 'claude-code' }, local)).toMatch(/could not be applied/);
    expect(personaMcpAllowlistLaunchNotice(ctx, { personaId: 'mystery', providerId: 'claude-code' }, remote)).toMatch(/could not be applied/);
  });

  it('launch notice: headless/scheduled/autonomous threads use the isolated Claude wording', () => {
    expect(personaMcpAllowlistLaunchNotice(ctx, { personaId: 'some', providerId: 'claude-code', headless: true }, local)).toMatch(/user-config/);
    expect(personaMcpAllowlistLaunchNotice(ctx, { personaId: 'some', providerId: 'claude-code' }, local)).not.toMatch(/user-config/);
  });
});

describe('persistence and emission', () => {
  it('persists mcpAllowlist with the thread metadata, including an empty-restriction list', () => {
    const c = { db: {} } as never;
    patch.calls.length = 0;
    persistThreadSkillSelection(c, 't1', {});
    expect(patch.calls).toEqual([]);
    persistThreadSkillSelection(c, 't1', { mcpAllowlist: ['zcc-inbox'] });
    expect(patch.calls[0]).toMatchObject({ threadId: 't1', set: { mcpAllowlist: ['zcc-inbox'] } });
    patch.ok = false;
    expect(() => persistThreadSkillSelection(c, 't1', { mcpAllowlist: ['x'] })).toThrow(/metadata limit/);
    patch.ok = true;
  });

  it('emits persona_mcp_allowlist as a warning timeline event and swallows store failures', () => {
    const emit = vi.fn();
    const c = { db: {}, hub: { emit } } as never;
    patch.events.length = 0;
    emitPersonaMcpNotice(c, 't9', undefined);
    expect(patch.events).toEqual([]);
    emitPersonaMcpNotice(c, 't9', 'limited');
    expect(patch.events[0]).toMatchObject({ threadId: 't9', type: 'system/operation',
      payload: { operation: PERSONA_MCP_ALLOWLIST_OPERATION, status: 'warning', message: 'limited' } });
    expect(emit).toHaveBeenCalledWith('threads:event', expect.objectContaining({ threadId: 't9', sequence: 3 }));
    patch.appendThrows = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => emitPersonaNotice(c, 't9', 'other_op', 'x')).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('other_op'));
    warn.mockRestore();
    patch.appendThrows = false;
  });
});
