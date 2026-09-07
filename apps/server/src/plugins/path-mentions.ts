import type { PromptInput } from '@zana-ai/zcc-domain/thread-runtime';
import type { HostReadFileResult } from '@zana-ai/zcc-contracts/host-rpc';
import type { ProductHttpContext } from '../http/product-context.js';
import { isSafeRelPath } from '../http/library-via-host.js';
import { confinePathToRoot } from '../services/threads/thread-path-confine.js';
import { readThreadHostFile } from '../services/threads/thread-host-file.js';
import { readThreadStorageFile } from '../services/threads/thread-storage.js';

export const PATH_MENTION_BODY_CAP = 32_768;

export type PathMentionSource = 'workspace' | 'thread-storage';

export interface PathMentionResource {
  kind: 'path';
  source: PathMentionSource;
  entryKind: 'file' | 'directory';
  path: string;
  label: string;
}

export interface PathMentionFileRead {
  content: string;
  encoding: 'utf8' | 'base64';
}

export interface PathMentionReaders {
  readWorkspaceFile(path: string): Promise<PathMentionFileRead | null>;
  readStorageFile?(path: string): Promise<PathMentionFileRead | null>;
}

function pathMentionResource(value: unknown): PathMentionResource | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.kind !== 'path') return null;
  if (typeof record.path !== 'string' || !record.path.trim()) return null;
  const source = record.source === 'thread-storage' ? 'thread-storage' : 'workspace';
  const entryKind = record.entryKind === 'directory' ? 'directory' : 'file';
  const label = typeof record.label === 'string' && record.label.trim()
    ? record.label.trim()
    : record.path.trim().split(/[/\\]/).pop() || record.path.trim();
  return {
    kind: 'path',
    source,
    entryKind,
    path: record.path.trim(),
    label
  };
}

/** Unique file path mentions in `input`, in first-appearance order. Directories are skipped. */
export function collectPathMentionResources(input: unknown): PathMentionResource[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const resources: PathMentionResource[] = [];
  for (const part of input) {
    if (!part || typeof part !== 'object' || Array.isArray(part)) continue;
    const record = part as { type?: unknown; mentions?: unknown };
    if (record.type !== 'text' || !Array.isArray(record.mentions)) continue;
    for (const mention of record.mentions) {
      if (!mention || typeof mention !== 'object' || Array.isArray(mention)) continue;
      const resource = pathMentionResource((mention as { resource?: unknown }).resource);
      if (!resource || resource.entryKind === 'directory') continue;
      const key = `${resource.source}::${resource.path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      resources.push(resource);
    }
  }
  return resources;
}

function cappedBody(content: string): string {
  if (content.length <= PATH_MENTION_BODY_CAP) return content;
  return `${content.slice(0, PATH_MENTION_BODY_CAP)}\n…`;
}

function contextPart(resource: PathMentionResource, body: string): PromptInput {
  const kindLabel = resource.source === 'thread-storage' ? 'thread storage file' : 'workspace file';
  return {
    type: 'text',
    text: `Context for @${resource.label} (${kindLabel} "${resource.path}"):\n\n${cappedBody(body)}`,
    mentions: [],
    visibility: 'agent-only'
  };
}

export async function resolvePathMentionContextInputs(
  input: unknown,
  readers: PathMentionReaders
): Promise<PromptInput[]> {
  const resources = collectPathMentionResources(input);
  if (resources.length === 0) return [];
  const extras: PromptInput[] = [];
  for (const resource of resources) {
    const read = resource.source === 'thread-storage'
      ? readers.readStorageFile
      : readers.readWorkspaceFile;
    if (!read) continue;
    let file: PathMentionFileRead | null = null;
    try {
      file = await read(resource.path);
    } catch {
      file = null;
    }
    if (!file || file.encoding !== 'utf8' || !file.content) continue;
    extras.push(contextPart(resource, file.content));
  }
  return extras;
}

export async function withResolvedPathMentionContext(
  input: unknown,
  readers: PathMentionReaders
): Promise<unknown> {
  const extras = await resolvePathMentionContextInputs(input, readers);
  if (extras.length === 0) return input;
  if (Array.isArray(input)) return [...input, ...extras];
  if (typeof input === 'string') {
    return [{ type: 'text', text: input, mentions: [] }, ...extras];
  }
  return extras;
}

export function threadPathMentionReaders(
  ctx: ProductHttpContext,
  threadId: string
): PathMentionReaders {
  return {
    async readWorkspaceFile(path) {
      try {
        const file = await readThreadHostFile(ctx, threadId, path);
        return { content: file.content, encoding: file.encoding };
      } catch {
        return null;
      }
    },
    async readStorageFile(path) {
      try {
        const file = await readThreadStorageFile(ctx, threadId, path);
        return { content: file.content, encoding: file.encoding };
      } catch {
        return null;
      }
    }
  };
}

export function workspacePathMentionReaders(
  ctx: ProductHttpContext,
  hostId: string,
  workspacePath: string
): PathMentionReaders {
  return {
    async readWorkspaceFile(candidate) {
      const relPath = confinePathToRoot(workspacePath, candidate);
      if (!relPath || !isSafeRelPath(relPath)) return null;
      try {
        const result = await ctx.hostHub.callHostOnlineRpc<HostReadFileResult>({
          hostId,
          command: {
            type: 'host.read_file',
            root: workspacePath,
            relPath
          }
        });
        return { content: result.content, encoding: result.encoding };
      } catch {
        return null;
      }
    }
  };
}
