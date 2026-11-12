import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  PERSONA_MCP_LEGACY_VALUE_OPERATION, personaMcpLegacyValueNotice, resetPersonaMcpLegacyNoticeState
} from '../thread-create.js';

const dataDir = mkdtempSync(join(tmpdir(), 'zcc-persona-mcp-legacy-'));
mkdirSync(join(dataDir, 'personas'));
const write = (id: string, extra: object) =>
  writeFileSync(join(dataDir, 'personas', `${id}.json`), JSON.stringify({ id, name: id, baseProfile: 'claude', ...extra }));
write('absent', {});
write('empty', { mcpServers: [] });
write('list', { mcpServers: ['zana', 'github'] });
write('malformed', { mcpServers: 'github' });
afterAll(() => rmSync(dataDir, { recursive: true, force: true }));
const ctx = { dataDir } as never;
const local = { path: '/nowhere' } as never;
const remote = { path: '/nowhere', remote: { hostId: 'h' } } as never;

describe('personaMcpLegacyValueNotice', () => {
  beforeEach(() => resetPersonaMcpLegacyNoticeState());

  it('uses the persona_mcp_legacy_value operation', () => {
    expect(PERSONA_MCP_LEGACY_VALUE_OPERATION).toBe('persona_mcp_legacy_value');
  });

  it('explicit [] warns that it now means no servers', () => {
    expect(personaMcpLegacyValueNotice(ctx, 'empty', local)?.message).toMatch(/empty MCP server list.*no MCP servers beyond zcc-inbox/);
  });

  it('explicit list warns it is now exclusive and names the servers', () => {
    const msg = personaMcpLegacyValueNotice(ctx, 'list', local)?.message;
    expect(msg).toMatch(/exclusive allowlist/);
    expect(msg).toContain('zana, github');
  });

  it('emits nothing for absent, malformed, unknown, built-in, ext: and no persona', () => {
    expect(personaMcpLegacyValueNotice(ctx, 'absent', local)).toBeUndefined();
    expect(personaMcpLegacyValueNotice(ctx, 'malformed', local)).toBeUndefined();
    expect(personaMcpLegacyValueNotice(ctx, 'missing', local)).toBeUndefined();
    expect(personaMcpLegacyValueNotice(ctx, 'missing', remote)).toBeUndefined();
    expect(personaMcpLegacyValueNotice(ctx, 'builtin:reviewer', local)).toBeUndefined();
    expect(personaMcpLegacyValueNotice(ctx, 'ext:acme/p', local)).toBeUndefined();
    expect(personaMcpLegacyValueNotice(ctx)).toBeUndefined();
  });

  it('is one-time per persona once committed, not before', () => {
    const first = personaMcpLegacyValueNotice(ctx, 'list', local);
    expect(personaMcpLegacyValueNotice(ctx, 'list', local)).toBeDefined();
    first?.commit();
    expect(personaMcpLegacyValueNotice(ctx, 'list', local)).toBeUndefined();
    expect(personaMcpLegacyValueNotice(ctx, 'empty', local)).toBeDefined();
  });

  it('is wired into thread.start for non-shell launches only, via the shared emitter', () => {
    const src = readFileSync(new URL('../thread-create.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/if \(family !== 'shell'\) \{\s+const legacy = personaMcpLegacyValueNotice\(/);
    expect(src).toContain('emitPersonaNotice(ctx, args.thread.id, PERSONA_MCP_LEGACY_VALUE_OPERATION, legacy.message)');
  });
});
