import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PERSONA_MCP_NAME_MAX, PERSONA_MCP_SERVERS_MAX } from '@zana-ai/zcc-domain/product';
import { CliPersonaSchema, PersonaMcpServersWireSchema } from './cli-terminal.js';
import { ThreadStartCommandSchema } from './host-rpc.js';

const names = (n: number) => Array.from({ length: n }, (_, i) => `s${i}`);
const persona = { id: 'p', name: 'P' };
const threadStart = (mcpServers?: unknown) => ({
  type: 'thread.start',
  threadId: randomUUID(),
  environmentId: randomUUID(),
  projectId: 'proj',
  providerId: 'claude',
  persona: { ...persona, ...(mcpServers === undefined ? {} : { mcpServers }) }
});

describe('persona mcpServers wire bounds', () => {
  it('accepts [], bare names, pinned keys and the max count', () => {
    for (const ok of [[], ['a'], ['plugin:x:y', 'ext:e:s'], names(PERSONA_MCP_SERVERS_MAX), ['x'.repeat(PERSONA_MCP_NAME_MAX)]]) {
      expect(PersonaMcpServersWireSchema.safeParse(ok).success).toBe(true);
    }
  });
  it('rejects over-count, over-length, empty, and non-string entries and non-arrays', () => {
    for (const bad of [names(PERSONA_MCP_SERVERS_MAX + 1), ['x'.repeat(PERSONA_MCP_NAME_MAX + 1)], [''], [1], 'a', {}, null]) {
      expect(PersonaMcpServersWireSchema.safeParse(bad).success).toBe(false);
    }
  });
  it('CliPersonaSchema applies the bounds and keeps the field optional', () => {
    expect(CliPersonaSchema.safeParse(persona).success).toBe(true);
    expect(CliPersonaSchema.safeParse({ ...persona, mcpServers: [] }).success).toBe(true);
    expect(CliPersonaSchema.safeParse({ ...persona, mcpServers: names(PERSONA_MCP_SERVERS_MAX + 1) }).success).toBe(false);
  });
  it('thread.start persona applies the bounds and keeps the field optional', () => {
    expect(ThreadStartCommandSchema.safeParse(threadStart()).success).toBe(true);
    expect(ThreadStartCommandSchema.safeParse(threadStart([])).success).toBe(true);
    expect(ThreadStartCommandSchema.safeParse(threadStart(['a'])).success).toBe(true);
    expect(ThreadStartCommandSchema.safeParse(threadStart(names(PERSONA_MCP_SERVERS_MAX + 1))).success).toBe(false);
    expect(ThreadStartCommandSchema.safeParse(threadStart(['x'.repeat(PERSONA_MCP_NAME_MAX + 1)])).success).toBe(false);
  });
});
