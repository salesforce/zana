import { afterEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const testHome = join(tmpdir(), `persona-mcp-test-${Date.now()}`);
vi.mock('electron', () => ({
  app: { getPath: (name: string) => { if (name === 'home') return testHome; throw new Error(`Unexpected getPath('${name}')`); } },
  shell: { openPath: vi.fn() }
}));

import { PERSONA_MCP_NAME_MAX, PERSONA_MCP_SERVERS_MAX } from '@zana-ai/zcc-domain/product';
import { sanitizeLegacyMcpServers, sanitizePersona, projectPersonaFields } from '../persona-store.js';

const base = { id: 'p', name: 'P' };

afterEach(() => vi.restoreAllMocks());

describe('persona-store mcpServers (lossless, tri-state)', () => {
  it('keeps absent as undefined and [] as []', () => {
    const absent = sanitizePersona(base)!;
    expect(absent.mcpServers).toBeUndefined();
    expect(sanitizePersona({ ...base, mcpServers: [] })!.mcpServers).toEqual([]);
  });
  it('keeps a valid list trimmed and deduped, including pinned keys', () => {
    const p = sanitizePersona({ ...base, mcpServers: [' a ', 'a', 'plugin:x:y', 'ext:e:s'] })!;
    expect(p.mcpServers).toEqual(['a', 'plugin:x:y', 'ext:e:s']);
    expect(projectPersonaFields(p).mcpServers).toEqual(['a', 'plugin:x:y', 'ext:e:s']);
  });
  it('never drops the persona for a legacy value; filters invalid entries with a warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const p = sanitizePersona({ ...base, mcpServers: ['ok', 'g*lob', '', 5, 'x'.repeat(PERSONA_MCP_NAME_MAX + 1), 'bad\nname', 'q?', null] });
    expect(p).not.toBeNull();
    expect(p!.mcpServers).toEqual(['ok']);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('dropped 7 invalid mcpServers entries'));
  });
  it('all-invalid list becomes [] (fail closed), singular wording for one drop', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(sanitizeLegacyMcpServers(['*'], 'p')).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('dropped 1 invalid mcpServers entry'));
  });
  it('treats a non-array value as absent with a warning, not a dropped persona', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const bad of ['zana', {}, null, 3]) {
      const p = sanitizePersona({ ...base, mcpServers: bad });
      expect(p).not.toBeNull();
      expect(p!.mcpServers).toBeUndefined();
    }
    expect(warn).toHaveBeenCalledTimes(4);
  });
  it('truncates over-count lists to the cap with a warning and dedupes first', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const many = Array.from({ length: PERSONA_MCP_SERVERS_MAX + 10 }, (_, i) => `s${i}`);
    expect(sanitizeLegacyMcpServers(many, 'p')).toHaveLength(PERSONA_MCP_SERVERS_MAX);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('truncated'));
    warn.mockClear();
    expect(sanitizeLegacyMcpServers([...many, ...many], 'p')).toHaveLength(PERSONA_MCP_SERVERS_MAX);
    const dupes = Array.from({ length: PERSONA_MCP_SERVERS_MAX + 5 }, () => 'same');
    expect(sanitizeLegacyMcpServers(dupes, 'p')).toEqual(['same']);
  });
  it('uses a placeholder label when the id is not a string', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    sanitizeLegacyMcpServers('x', 7);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"?"'));
  });
});

describe('persona README schema help', () => {
  it('documents mcpServers semantics', async () => {
    const { mkdtempSync, readFileSync, rmSync } = await import('node:fs');
    const { ensureReadme } = await import('../persona-store.js');
    const dir = mkdtempSync(join(tmpdir(), 'persona-readme-'));
    try {
      ensureReadme(dir);
      const text = readFileSync(join(dir, 'README.md'), 'utf8');
      expect(text).toContain('`mcpServers`');
      expect(text).toContain('`zcc-inbox` is always kept');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
