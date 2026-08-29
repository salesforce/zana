/**
 * Local harness, remote tools. When a thread starts with `remoteToolProxy`,
 * native Read/Write/Bash stay on the local placeholder cwd — they cannot be
 * rewritten — so we deny them and expose replacements that run over the
 * existing SSH ControlMaster path (`remote-fs` / `execRemote`).
 */

import type { DynamicTool, ToolCallResponse } from '@zana-ai/zcc-domain/thread-runtime';
import type { ProjectRemote } from '@zana-ai/zcc-domain/product';
import {
  createFileRemote,
  execRemote,
  globRemote,
  grepRemote,
  readFileRemote,
  remoteRoot,
  writeFileRemote
} from './remote-fs.js';

export const REMOTE_TOOL_PROXY_DISALLOWED_TOOLS = [
  'Bash',
  'Read',
  'Write',
  'Edit',
  'Glob',
  'Grep',
  'LS',
  'NotebookEdit'
] as const;

export const REMOTE_TOOL_PROXY_INSTRUCTIONS = [
  'This project’s files live on a remote SSH host. Native filesystem and shell',
  'tools (Read, Write, Edit, Glob, Grep, Bash, LS) operate on a local placeholder',
  'and are disabled. Use remote_read, remote_write, remote_edit, remote_glob,',
  'remote_grep, and remote_exec instead (Claude Code exposes them as',
  'mcp__bb-bridge__remote_read and the same mcp__bb-bridge__ prefix for the others;',
  'ToolSearch select:mcp__bb-bridge__remote_exec if they are deferred). Paths are',
  'relative to the remote project root (or absolute under that root). You never',
  'pass a host or credentials.'
].join(' ');

const PATH_SCHEMA = {
  type: 'object',
  properties: {
    path: { type: 'string', description: 'Path under the remote project root.' }
  },
  required: ['path']
} as const;

export const REMOTE_TOOL_PROXY_DYNAMIC_TOOLS: DynamicTool[] = [
  {
    name: 'remote_read',
    description: 'Read a file on the remote SSH project (capped). Native Read is disabled.',
    inputSchema: PATH_SCHEMA
  },
  {
    name: 'remote_write',
    description: 'Write a file on the remote SSH project. Creates the file when it does not exist. Native Write is disabled.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path under the remote project root.' },
        content: { type: 'string', description: 'Full file contents to write.' }
      },
      required: ['path', 'content']
    }
  },
  {
    name: 'remote_edit',
    description: 'Replace a unique substring in a remote file. Native Edit is disabled.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        old_string: { type: 'string', description: 'Exact text to find (must occur once).' },
        new_string: { type: 'string', description: 'Replacement text.' }
      },
      required: ['path', 'old_string', 'new_string']
    }
  },
  {
    name: 'remote_glob',
    description: 'List remote files matching a glob. Native Glob is disabled.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Glob such as *.ts or **/*.md.' },
        path: { type: 'string', description: 'Optional directory under the remote root.' }
      },
      required: ['pattern']
    }
  },
  {
    name: 'remote_grep',
    description: 'Search remote file contents (bounded). Native Grep is disabled.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Extended regex to search for.' },
        path: { type: 'string', description: 'Optional directory or file under the remote root.' }
      },
      required: ['pattern']
    }
  },
  {
    name: 'remote_exec',
    description: 'Run a shell command on the remote SSH project. Native Bash is disabled. This is the Shell tool.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Command run by the remote login shell inside the project root.' },
        cwd: { type: 'string', description: 'Optional working directory under the project root.' }
      },
      required: ['command']
    }
  }
];

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function argsRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export async function executeRemoteProxyTool(
  remote: ProjectRemote,
  root: string,
  tool: string,
  rawArgs: unknown
): Promise<{ success: boolean; text: string }> {
  const args = argsRecord(rawArgs);
  if (tool === 'remote_read') {
    const path = asString(args.path);
    if (!path) return { success: false, text: 'path is required' };
    const read = await readFileRemote(remote, root, path);
    if (!read.ok) return { success: false, text: read.message ?? 'read failed' };
    if (read.binary) return { success: false, text: 'Binary file' };
    return { success: true, text: read.content ?? '' };
  }
  if (tool === 'remote_write') {
    const path = asString(args.path);
    const content = asString(args.content);
    if (!path) return { success: false, text: 'path is required' };
    if (content === undefined) return { success: false, text: 'content is required' };
    const written = await writeFileRemote(remote, root, path, content);
    if (written.ok) return { success: true, text: JSON.stringify({ bytes: written.bytes ?? content.length }) };
    if (written.message !== 'Not a regular file') {
      return { success: false, text: written.message ?? 'write failed' };
    }
    const created = await createFileRemote(remote, root, path);
    if (!created.ok) return { success: false, text: created.message ?? 'create failed' };
    const retry = await writeFileRemote(remote, root, path, content);
    if (!retry.ok) return { success: false, text: retry.message ?? 'write failed' };
    return { success: true, text: JSON.stringify({ bytes: retry.bytes ?? content.length }) };
  }
  if (tool === 'remote_edit') {
    const path = asString(args.path);
    const oldString = asString(args.old_string);
    const newString = asString(args.new_string);
    if (!path || oldString === undefined || newString === undefined) {
      return { success: false, text: 'path, old_string, and new_string are required' };
    }
    const read = await readFileRemote(remote, root, path);
    if (!read.ok) return { success: false, text: read.message ?? 'read failed' };
    if (read.binary) return { success: false, text: 'Binary file' };
    const body = read.content ?? '';
    const first = body.indexOf(oldString);
    if (first < 0) return { success: false, text: 'old_string not found' };
    if (body.indexOf(oldString, first + oldString.length) >= 0) {
      return { success: false, text: 'old_string is not unique' };
    }
    const next = body.slice(0, first) + newString + body.slice(first + oldString.length);
    const written = await writeFileRemote(remote, root, path, next);
    if (!written.ok) return { success: false, text: written.message ?? 'write failed' };
    return { success: true, text: JSON.stringify({ bytes: written.bytes ?? next.length }) };
  }
  if (tool === 'remote_glob') {
    const pattern = asString(args.pattern);
    if (!pattern) return { success: false, text: 'pattern is required' };
    const globbed = await globRemote(remote, root, pattern, asString(args.path));
    if (!globbed.ok) return { success: false, text: globbed.message };
    return { success: true, text: globbed.files.join('\n') };
  }
  if (tool === 'remote_grep') {
    const pattern = asString(args.pattern);
    if (!pattern) return { success: false, text: 'pattern is required' };
    const grepped = await grepRemote(remote, root, pattern, asString(args.path));
    if (!grepped.ok) return { success: false, text: grepped.message };
    return {
      success: true,
      text: JSON.stringify({ output: grepped.output, truncated: grepped.truncated })
    };
  }
  if (tool === 'remote_exec') {
    const command = asString(args.command);
    if (!command) return { success: false, text: 'command is required' };
    const cwd = asString(args.cwd);
    const result = await execRemote(remote, root, command, cwd ? { cwd } : undefined);
    if (!result.ok) return { success: false, text: result.message ?? 'exec failed' };
    return {
      success: true,
      text: JSON.stringify({
        exitCode: result.code ?? null,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
        truncated: result.truncated === true
      })
    };
  }
  return { success: false, text: `unknown remote tool: ${tool}` };
}

export async function remoteProxyToolCallResponse(
  remote: ProjectRemote,
  defaultPath: string | undefined,
  tool: string,
  rawArgs: unknown
): Promise<ToolCallResponse> {
  const rootRes = await remoteRoot(remote, defaultPath);
  if (!rootRes.ok || !rootRes.root) {
    return {
      contentItems: [{ type: 'inputText', text: rootRes.message || 'Remote host unreachable or start path missing' }],
      success: false
    };
  }
  const result = await executeRemoteProxyTool(remote, rootRes.root, tool, rawArgs);
  return {
    contentItems: [{ type: 'inputText', text: result.text }],
    success: result.success
  };
}

export function isRemoteProxyTool(name: string): boolean {
  return REMOTE_TOOL_PROXY_DYNAMIC_TOOLS.some((tool) => tool.name === name);
}

export type ThreadRemoteProxy = {
  remote: ProjectRemote;
  defaultPath?: string;
};

/** Narrow host-rpc `remote` onto the product SSH shape. */
export function projectRemoteFromLaunch(
  remote: { host: string; user?: string; remotePath?: string; proxyJump?: string }
): ProjectRemote {
  return {
    host: remote.host,
    ...(remote.user ? { user: remote.user } : {}),
    ...(remote.remotePath ? { remotePath: remote.remotePath } : {}),
    ...(remote.proxyJump ? { proxyJump: remote.proxyJump } : {})
  };
}

/** Per-thread proxy state: launch remote plus the global start-path fallback. */
export function buildThreadRemoteProxy(
  remote: { host: string; user?: string; remotePath?: string; proxyJump?: string },
  defaultPath?: string
): ThreadRemoteProxy {
  return {
    remote: projectRemoteFromLaunch(remote),
    ...(defaultPath ? { defaultPath } : {})
  };
}

export function usesRemoteToolProxy(input: {
  remoteToolProxy?: boolean;
  remote?: { host: string };
}): boolean {
  return input.remoteToolProxy === true && Boolean(input.remote?.host);
}
