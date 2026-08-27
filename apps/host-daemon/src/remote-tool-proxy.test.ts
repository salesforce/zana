import { describe, expect, it } from 'vitest';
import {
  buildThreadRemoteProxy,
  isRemoteProxyTool,
  projectRemoteFromLaunch,
  usesRemoteToolProxy,
  REMOTE_TOOL_PROXY_DISALLOWED_TOOLS,
  REMOTE_TOOL_PROXY_DYNAMIC_TOOLS,
  REMOTE_TOOL_PROXY_INSTRUCTIONS
} from './remote-tool-proxy.js';

describe('remote tool proxy helpers', () => {
  it('requires the flag and an SSH remote before enabling', () => {
    expect(usesRemoteToolProxy({ remoteToolProxy: true, remote: { host: 'box' } })).toBe(true);
    expect(usesRemoteToolProxy({ remoteToolProxy: true })).toBe(false);
    expect(usesRemoteToolProxy({ remote: { host: 'box' } })).toBe(false);
    expect(usesRemoteToolProxy({})).toBe(false);
  });

  it('denies native fs/shell tools and exposes remote_* replacements', () => {
    expect(REMOTE_TOOL_PROXY_DISALLOWED_TOOLS).toEqual(expect.arrayContaining([
      'Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep'
    ]));
    expect(REMOTE_TOOL_PROXY_DYNAMIC_TOOLS.map((tool) => tool.name)).toEqual([
      'remote_read',
      'remote_write',
      'remote_edit',
      'remote_glob',
      'remote_grep',
      'remote_exec'
    ]);
    expect(isRemoteProxyTool('remote_read')).toBe(true);
    expect(isRemoteProxyTool('Bash')).toBe(false);
  });

  it('copies launch remote identity without extra fields', () => {
    expect(projectRemoteFromLaunch({
      host: 'box',
      user: 'me',
      remotePath: '/src',
      proxyJump: 'jump'
    })).toEqual({
      host: 'box',
      user: 'me',
      remotePath: '/src',
      proxyJump: 'jump'
    });
  });

  it('keeps the global remote start-path fallback on the per-thread proxy', () => {
    expect(buildThreadRemoteProxy({ host: 'limited-pony' }, '/home/sfwork/core')).toEqual({
      remote: { host: 'limited-pony' },
      defaultPath: '/home/sfwork/core'
    });
    expect(buildThreadRemoteProxy({ host: 'limited-pony' })).toEqual({
      remote: { host: 'limited-pony' }
    });
  });

  it('tells Claude Code the MCP-prefixed remote tool names', () => {
    expect(REMOTE_TOOL_PROXY_INSTRUCTIONS).toMatch(/mcp__bb-bridge__remote_read/);
    expect(REMOTE_TOOL_PROXY_INSTRUCTIONS).toMatch(/mcp__bb-bridge__remote_exec/);
  });
});
