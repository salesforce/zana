/**
 * Route-scoped remote file tools (Read/Write/Edit/Glob/Grep) for SSH projects.
 *
 * Unlike `remote_exec` (agent-supplied projectId), these close over the MCP
 * URL's projectId so the model cannot pick an arbitrary host. Main resolves
 * `project.remote` from the store (Rule 1) and confines every path under that
 * remote root (Rule 2). Keep `remote_exec` as Shell.
 */

import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FsEntry, FsReadResult, FsWriteResult } from '@zana-ai/zcc-domain/product';

export const REMOTE_FS_TOOL_NAMES = [
  'remote_read',
  'remote_write',
  'remote_edit',
  'remote_glob',
  'remote_grep'
] as const;

export interface RegisterRemoteFsToolsOpts {
  /** Authoritative project id from the MCP URL — never an agent-supplied host. */
  projectId: string;
  readFile: (projectId: string, path: string) => Promise<FsReadResult>;
  writeFile: (projectId: string, path: string, content: string) => Promise<FsWriteResult>;
  listDir: (
    projectId: string,
    path: string
  ) => Promise<{ ok: true; entries: FsEntry[] } | { ok: false; message: string }>;
  glob: (
    projectId: string,
    pattern: string,
    searchPath?: string
  ) => Promise<{ ok: true; files: string[] } | { ok: false; message: string }>;
  grep: (
    projectId: string,
    pattern: string,
    searchPath?: string
  ) => Promise<{ ok: true; output: string; truncated: boolean } | { ok: false; message: string }>;
}

function errorResult(prefix: string, message: string) {
  return {
    isError: true as const,
    content: [{ type: 'text' as const, text: `${prefix}: ${message}` }]
  };
}

function okText(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

async function applyEdit(
  opts: RegisterRemoteFsToolsOpts,
  path: string,
  oldString: string,
  newString: string
): Promise<{ ok: true; bytes: number } | { ok: false; message: string }> {
  const read = await opts.readFile(opts.projectId, path);
  if (!read.ok) return { ok: false, message: read.message ?? 'read failed' };
  if (read.binary) return { ok: false, message: 'Binary file' };
  const body = read.content ?? '';
  const first = body.indexOf(oldString);
  if (first < 0) return { ok: false, message: 'old_string not found' };
  if (body.indexOf(oldString, first + oldString.length) >= 0) {
    return { ok: false, message: 'old_string is not unique' };
  }
  const next = body.slice(0, first) + newString + body.slice(first + oldString.length);
  const written = await opts.writeFile(opts.projectId, path, next);
  if (!written.ok) return { ok: false, message: written.message ?? 'write failed' };
  return { ok: true, bytes: written.bytes ?? next.length };
}

/**
 * Register remote file tools scoped to `opts.projectId` from the MCP URL.
 * `remote_exec` stays the Shell tool (registered separately).
 */
export function registerRemoteFsTools(server: McpServer, opts: RegisterRemoteFsToolsOpts): void {
  const projectId = opts.projectId;

  server.registerTool(
    'remote_read',
    {
      description: [
        'Read a file on THIS remote (SSH) project. Native Read is disabled when',
        'local-agent/remote-tools is on. Paths are under the remote project root;',
        'you never pass a host or credentials.'
      ].join(' '),
      inputSchema: {
        path: z.string().describe('Path under the remote project root.')
      }
    },
    async ({ path }) => {
      try {
        const result = await opts.readFile(projectId, path);
        if (!result.ok) return errorResult('remote_read failed', result.message ?? 'unknown error');
        if (result.binary) return errorResult('remote_read failed', 'Binary file');
        return okText(result.content ?? '');
      } catch (err) {
        return errorResult('remote_read failed', err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.registerTool(
    'remote_write',
    {
      description: [
        'Write a file on THIS remote (SSH) project. Creates the file when it does',
        'not exist. Native Write is disabled when local-agent/remote-tools is on.'
      ].join(' '),
      inputSchema: {
        path: z.string().describe('Path under the remote project root.'),
        content: z.string().describe('Full file contents to write.')
      }
    },
    async ({ path, content }) => {
      try {
        const result = await opts.writeFile(projectId, path, content);
        if (!result.ok) return errorResult('remote_write failed', result.message ?? 'unknown error');
        return okText(JSON.stringify({ bytes: result.bytes ?? content.length }));
      } catch (err) {
        return errorResult('remote_write failed', err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.registerTool(
    'remote_edit',
    {
      description: [
        'Replace a unique substring in a file on THIS remote (SSH) project.',
        'Native Edit is disabled when local-agent/remote-tools is on.'
      ].join(' '),
      inputSchema: {
        path: z.string().describe('Path under the remote project root.'),
        old_string: z.string().describe('Exact text to find (must occur once).'),
        new_string: z.string().describe('Replacement text.')
      }
    },
    async ({ path, old_string, new_string }) => {
      try {
        const result = await applyEdit(opts, path, old_string, new_string);
        if (!result.ok) return errorResult('remote_edit failed', result.message);
        return okText(JSON.stringify({ bytes: result.bytes }));
      } catch (err) {
        return errorResult('remote_edit failed', err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.registerTool(
    'remote_glob',
    {
      description: [
        'List files matching a glob on THIS remote (SSH) project. Native Glob is',
        'disabled when local-agent/remote-tools is on. Results are bounded.'
      ].join(' '),
      inputSchema: {
        pattern: z.string().describe('Glob such as *.ts or **/*.md.'),
        path: z.string().optional().describe('Optional directory under the remote root.')
      }
    },
    async ({ pattern, path }) => {
      try {
        const result = await opts.glob(projectId, pattern, path);
        if (!result.ok) return errorResult('remote_glob failed', result.message);
        return okText(result.files.join('\n'));
      } catch (err) {
        return errorResult('remote_glob failed', err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.registerTool(
    'remote_grep',
    {
      description: [
        'Search file contents on THIS remote (SSH) project. Native Grep is',
        'disabled when local-agent/remote-tools is on. Output is bounded.'
      ].join(' '),
      inputSchema: {
        pattern: z.string().describe('Extended regex to search for.'),
        path: z.string().optional().describe('Optional directory or file under the remote root.')
      }
    },
    async ({ pattern, path }) => {
      try {
        const result = await opts.grep(projectId, pattern, path);
        if (!result.ok) return errorResult('remote_grep failed', result.message);
        return okText(JSON.stringify({ output: result.output, truncated: result.truncated }));
      } catch (err) {
        return errorResult('remote_grep failed', err instanceof Error ? err.message : String(err));
      }
    }
  );
}