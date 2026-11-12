import { describe, expect, it } from 'vitest';
import {
  ALWAYS_ALLOWED_MCP_SERVERS,
  effectiveMcpServers,
  mcpAllowlistCovers,
  PERSONA_MCP_NAME_MAX,
  PERSONA_MCP_SERVERS_MAX,
  sanitizePersonaMcpServers,
  type McpServerRef
} from '../product.js';

const user = (name: string): McpServerRef => ({ key: name, source: 'user', name });
const project = (name: string): McpServerRef => ({ key: name, source: 'project', name });
const plugin = (id: string, name: string): McpServerRef => ({ key: `plugin:${id}:${name}`, source: 'plugin', name });
const ext = (id: string, name: string): McpServerRef => ({ key: `ext:${id}:${name}`, source: 'extension', name });

describe('ALWAYS_ALLOWED_MCP_SERVERS', () => {
  it('is pinned to zcc-inbox only', () => {
    expect([...ALWAYS_ALLOWED_MCP_SERVERS]).toEqual(['zcc-inbox']);
  });
  it('keeps list bounds within the 64-server seed cap', () => {
    expect(PERSONA_MCP_SERVERS_MAX + ALWAYS_ALLOWED_MCP_SERVERS.length).toBe(64);
    expect(PERSONA_MCP_NAME_MAX).toBe(128);
  });
});

describe('mcpAllowlistCovers', () => {
  it('bare name covers user, project and plugin servers with that name', () => {
    expect(mcpAllowlistCovers('github', user('github'))).toBe(true);
    expect(mcpAllowlistCovers('github', project('github'))).toBe(true);
    expect(mcpAllowlistCovers('github', plugin('p1', 'github'))).toBe(true);
    expect(mcpAllowlistCovers('github', user('gitlab'))).toBe(false);
  });
  it('bare name covers extension servers by name', () => {
    expect(mcpAllowlistCovers('docs', ext('e1', 'docs'))).toBe(true);
    expect(mcpAllowlistCovers('docs', ext('e1', 'other'))).toBe(false);
  });
  it('an ambiguous bare name covers every same-named server across sources', () => {
    const all = [user('x'), project('x'), plugin('p1', 'x'), ext('e1', 'x')];
    expect(all.every((s) => mcpAllowlistCovers('x', s))).toBe(true);
  });
  it('a bare name never matches an unknown source', () => {
    expect(mcpAllowlistCovers('x', { key: 'x', source: 'other', name: 'x' })).toBe(false);
  });
  it('plugin: entry pins the plugin source and key', () => {
    expect(mcpAllowlistCovers('plugin:p1:github', plugin('p1', 'github'))).toBe(true);
    expect(mcpAllowlistCovers('plugin:p1:github', plugin('p2', 'github'))).toBe(false);
    expect(mcpAllowlistCovers('plugin:p1:github', user('github'))).toBe(false);
    expect(mcpAllowlistCovers('plugin:p1:github', ext('p1', 'github'))).toBe(false);
  });
  it('ext: entry pins the extension source and key', () => {
    expect(mcpAllowlistCovers('ext:e1:docs', ext('e1', 'docs'))).toBe(true);
    expect(mcpAllowlistCovers('ext:e1:docs', ext('e2', 'docs'))).toBe(false);
    expect(mcpAllowlistCovers('ext:e1:docs', plugin('e1', 'docs'))).toBe(false);
  });
  it('a user server named with a reserved prefix is never matched by a bare or pinned entry', () => {
    const spoof = user('plugin:p1:github');
    expect(mcpAllowlistCovers('github', spoof)).toBe(false);
    expect(mcpAllowlistCovers('plugin:p1:github', spoof)).toBe(false);
    const spoofExt = project('ext:e1:docs');
    expect(mcpAllowlistCovers('docs', spoofExt)).toBe(false);
    expect(mcpAllowlistCovers('ext:e1:docs', spoofExt)).toBe(false);
  });
  it('does not expand globs', () => {
    expect(mcpAllowlistCovers('git*', user('github'))).toBe(false);
    expect(mcpAllowlistCovers('*', user('github'))).toBe(false);
    expect(mcpAllowlistCovers('plugin:*', plugin('p1', 'github'))).toBe(false);
  });
  it('is server-level only: a name:tool entry matches no server', () => {
    expect(mcpAllowlistCovers('github:create_issue', user('github'))).toBe(false);
    expect(mcpAllowlistCovers('github:create_issue', plugin('p1', 'github'))).toBe(false);
  });
});

describe('sanitizePersonaMcpServers', () => {
  it('returns undefined for absent and preserves an empty list', () => {
    expect(sanitizePersonaMcpServers(undefined)).toBeUndefined();
    expect(sanitizePersonaMcpServers([])).toEqual([]);
  });
  it('trims and dedupes, keeping colon-bearing keys', () => {
    expect(sanitizePersonaMcpServers([' a ', 'a', 'plugin:p:b', 'ext:e:c'])).toEqual(['a', 'plugin:p:b', 'ext:e:c']);
  });
  it('rejects malformed values with null', () => {
    for (const bad of [null, 'a', 1, {}, [1], [''], ['  '], ['a*'], ['a?'], ['a[b'], ['a]'], ['{a}'], ['a\nb'], ['a\u0000'], ['a\u007f']]) {
      expect(sanitizePersonaMcpServers(bad)).toBeNull();
    }
  });
  it('enforces count and name length bounds', () => {
    const max = Array.from({ length: PERSONA_MCP_SERVERS_MAX }, (_, i) => `s${i}`);
    expect(sanitizePersonaMcpServers(max)).toHaveLength(PERSONA_MCP_SERVERS_MAX);
    expect(sanitizePersonaMcpServers([...max, 'extra'])).toBeNull();
    expect(sanitizePersonaMcpServers(['a'.repeat(PERSONA_MCP_NAME_MAX)])).toHaveLength(1);
    expect(sanitizePersonaMcpServers(['a'.repeat(PERSONA_MCP_NAME_MAX + 1)])).toBeNull();
  });
});

describe('effectiveMcpServers', () => {
  it('absent persona or list is unrestricted, even for lean workers', () => {
    expect(effectiveMcpServers(undefined, undefined)).toBeUndefined();
    expect(effectiveMcpServers(undefined, {})).toBeUndefined();
    expect(effectiveMcpServers({ leanWorkers: true }, {}, 'worker')).toBeUndefined();
  });
  it('empty list keeps only zcc-inbox', () => {
    expect(effectiveMcpServers(undefined, { mcpServers: [] }, 'worker')).toEqual(['zcc-inbox']);
  });
  it('list is exactly those servers plus zcc-inbox, deduped', () => {
    expect(effectiveMcpServers(undefined, { mcpServers: ['a', 'zcc-inbox'] })).toEqual(['zcc-inbox', 'a']);
  });
});
