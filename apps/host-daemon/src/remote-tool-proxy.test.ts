import { describe, expect, it, vi } from 'vitest';
import { readFileRemote } from './remote-fs.js';

vi.mock('./remote-fs.js', () => ({
  createFileRemote: vi.fn(),
  execRemote: vi.fn(),
  globRemote: vi.fn(),
  grepRemote: vi.fn(),
  readFileRemote: vi.fn(),
  remoteRoot: vi.fn(),
  writeFileRemote: vi.fn()
}));
import {
  buildThreadRemoteProxy,
  executeRemoteProxyTool,
  isRemoteProxyTool,
  projectRemoteFromLaunch,
  usesRemoteToolProxy,
  CLI_REMOTE_TOOL_PROXY_INSTRUCTIONS,
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
    const read = REMOTE_TOOL_PROXY_DYNAMIC_TOOLS.find((tool) => tool.name === 'remote_read');
    expect(read?.description).toContain('nextByteOffset');
    expect(read?.inputSchema).toMatchObject({ properties: { byte_offset: { minimum: 0 } } });
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
    expect(REMOTE_TOOL_PROXY_INSTRUCTIONS).toMatch(/mcp__zcc__remote_read/);
    expect(REMOTE_TOOL_PROXY_INSTRUCTIONS).toMatch(/mcp__zcc__remote_exec/);
  });

  it('tells a local CLI the zcc-inbox remote tool names', () => {
    expect(CLI_REMOTE_TOOL_PROXY_INSTRUCTIONS).toMatch(/mcp__zcc-inbox__remote_read/);
    expect(CLI_REMOTE_TOOL_PROXY_INSTRUCTIONS).toMatch(/mcp__zcc-inbox__remote_exec/);
    expect(CLI_REMOTE_TOOL_PROXY_INSTRUCTIONS).not.toMatch(/mcp__zcc__/);
  });

  it('rejects malformed remote_read cursors before touching remote filesystem', async () => {
    const remote = { host: 'unreachable.example' };
    const root = '/project';

    await expect(executeRemoteProxyTool(remote, root, 'remote_read', {
      path: 'README.md', byte_offset: -1
    })).resolves.toEqual({ success: false, text: 'byte_offset must be a non-negative integer' });
    await expect(executeRemoteProxyTool(remote, root, 'remote_read', {
      path: 'README.md', byte_offset: 1.5
    })).resolves.toEqual({ success: false, text: 'byte_offset must be a non-negative integer' });
    await expect(executeRemoteProxyTool(remote, root, 'remote_read', {
      path: 'README.md', byte_offset: '1'
    })).resolves.toEqual({ success: false, text: 'byte_offset must be a non-negative integer' });
  });

  it('passes a valid cursor to remote_read and serializes its continuation page', async () => {
    vi.mocked(readFileRemote).mockResolvedValueOnce({
      ok: true,
      content: 'next page',
      bytes: 20,
      truncated: true,
      nextByteOffset: 10,
      binary: false
    });
    const remote = { host: 'box.example' };

    await expect(executeRemoteProxyTool(remote, '/project', 'remote_read', {
      path: 'README.md', byte_offset: 4
    })).resolves.toEqual({
      success: true,
      text: JSON.stringify({ content: 'next page', bytes: 20, truncated: true, nextByteOffset: 10 })
    });
    expect(readFileRemote).toHaveBeenCalledWith(remote, '/project', 'README.md', 4);
  });

  it('returns remote_read validation and filesystem failures', async () => {
    const remote = { host: 'box.example' };
    await expect(executeRemoteProxyTool(remote, '/project', 'remote_read', {})).resolves.toEqual({
      success: false,
      text: 'path is required'
    });

    vi.mocked(readFileRemote).mockResolvedValueOnce({ ok: false, message: 'not found' });
    await expect(executeRemoteProxyTool(remote, '/project', 'remote_read', { path: 'missing.txt' })).resolves.toEqual({
      success: false,
      text: 'not found'
    });

    vi.mocked(readFileRemote).mockResolvedValueOnce({ ok: true, binary: true, bytes: 3 });
    await expect(executeRemoteProxyTool(remote, '/project', 'remote_read', { path: 'binary.dat' })).resolves.toEqual({
      success: false,
      text: 'Binary file'
    });
  });

  it('serializes a complete remote_read page without a continuation cursor', async () => {
    vi.mocked(readFileRemote).mockResolvedValueOnce({
      ok: true,
      content: 'complete',
      bytes: 8,
      truncated: false,
      binary: false
    });

    await expect(executeRemoteProxyTool({ host: 'box.example' }, '/project', 'remote_read', {
      path: 'README.md'
    })).resolves.toEqual({
      success: true,
      text: JSON.stringify({ content: 'complete', bytes: 8, truncated: false })
    });
  });

  it('defaults missing complete remote_read page metadata', async () => {
    vi.mocked(readFileRemote).mockResolvedValueOnce({ ok: true, binary: false });

    await expect(executeRemoteProxyTool({ host: 'box.example' }, '/project', 'remote_read', {
      path: 'README.md'
    })).resolves.toEqual({
      success: true,
      text: JSON.stringify({ content: '', bytes: 0, truncated: false })
    });
  });
});
