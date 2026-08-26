import { posix } from 'node:path';
import type { HostListFilesResult, HostReadFileResult } from '@zana-ai/zcc-contracts/host-rpc';
import type { FsReadResult, LibraryDoc, LibraryDocKind, LibraryScope, QuickPrompt } from '@zana-ai/zcc-domain/product';
import { AmbiguousHostError, HostUnavailableError } from './host-hub.js';
import type { ProductHttpContext } from './product-context.js';

function kindFromExt(ext: string): LibraryDocKind {
  const lower = ext.toLowerCase();
  if (lower === '.md' || lower === '.markdown') return 'md';
  if (lower === '.pdf') return 'pdf';
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(lower)) return 'image';
  if ([
    '.js', '.ts', '.tsx', '.jsx', '.py', '.java', '.go', '.rs', '.c', '.cpp', '.h', '.hpp',
    '.sh', '.bash', '.zsh', '.json', '.yaml', '.yml', '.toml', '.xml', '.html', '.css', '.scss', '.sql'
  ].includes(lower)) {
    return 'code';
  }
  return 'other';
}

function isSafeRelPath(relPath: string): boolean {
  const normalized = relPath.split('\\').join('/');
  if (!normalized || normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) return false;
  const parts = normalized.split('/');
  return parts.every((part) => part.length > 0 && part !== '.' && part !== '..');
}

export interface LibraryRoot {
  root: string;
  scope: LibraryScope;
  projectId?: string;
  projectName?: string;
  hostId?: string;
}

export function authorizedLibraryRoots(ctx: ProductHttpContext): LibraryRoot[] {
  const roots: LibraryRoot[] = [{ root: `${ctx.dataDir}/library`, scope: 'global' }];
  for (const project of ctx.toProjects()) {
    if (project.remote) continue;
    roots.push({
      root: `${project.path}/.zcc/library`,
      scope: 'project',
      projectId: project.id,
      projectName: project.name,
      hostId: project.hostId
    });
  }
  return roots;
}

export function authorizedQuickPromptRoot(ctx: ProductHttpContext): string {
  return `${ctx.dataDir}/quick-prompts`;
}

function mapHostError(error: unknown): never {
  if (error instanceof HostUnavailableError) {
    throw Object.assign(new Error(error.message), { status: 503, code: 'host-unavailable' });
  }
  if (error instanceof AmbiguousHostError) {
    throw Object.assign(new Error(error.message), { status: 409, code: 'ambiguous-host' });
  }
  throw error;
}

export async function listLibraryDocs(ctx: ProductHttpContext, hostId?: string): Promise<LibraryDoc[]> {
  const roots = authorizedLibraryRoots(ctx);
  const groups = new Map<string | undefined, typeof roots>();
  for (const root of roots) {
    const key = hostId ?? root.hostId;
    const list = groups.get(key) ?? [];
    list.push(root);
    groups.set(key, list);
  }
  const byRoot = new Map(roots.map((row) => [row.root, row]));
  const docs: LibraryDoc[] = [];
  for (const [groupHost, groupRoots] of groups) {
    let result: HostListFilesResult;
    try {
      const resolved = ctx.hostHub.resolveHostId(groupHost);
      result = await ctx.hostHub.callHostOnlineRpc<HostListFilesResult>({
        hostId: resolved,
        command: { type: 'host.list_files', roots: groupRoots.map((row) => row.root) }
      });
    } catch (error) {
      if (groups.size === 1) mapHostError(error);
      continue;
    }
    for (const file of result.files) {
      if (file.kind !== 'file') continue;
      if (file.relPath === 'index.json' || file.relPath.endsWith('/index.json')) continue;
      const meta = byRoot.get(file.root);
      if (!meta) continue;
      const ext = posix.extname(file.relPath);
      docs.push({
        id: `${meta.scope}:${meta.projectId ?? 'global'}:${file.relPath}`,
        relPath: file.relPath,
        title: posix.basename(file.relPath),
        kind: kindFromExt(ext),
        createdAt: 0,
        updatedAt: 0,
        bytes: file.bytes,
        scope: meta.scope,
        absPath: posix.join(file.root, file.relPath),
        projectId: meta.projectId,
        projectName: meta.projectName
      });
    }
  }
  return docs;
}

export async function readLibraryDoc(
  ctx: ProductHttpContext,
  scope: LibraryScope,
  relPath: string,
  projectId?: string,
  hostId?: string
): Promise<FsReadResult> {
  if (!isSafeRelPath(relPath)) {
    return { ok: false, message: 'path escapes library root' };
  }
  const roots = authorizedLibraryRoots(ctx);
  const root = roots.find((row) =>
    row.scope === scope && (scope === 'global' ? true : row.projectId === projectId)
  );
  if (!root) return { ok: false, message: 'library root is not authorized' };
  try {
    const resolved = ctx.hostHub.resolveHostId(hostId ?? root.hostId);
    const result = await ctx.hostHub.callHostOnlineRpc<HostReadFileResult>({
      hostId: resolved,
      command: { type: 'host.read_file', root: root.root, relPath }
    });
    return { ok: true, content: result.content };
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && (error as { code: string }).code === 'path_not_found') {
      return { ok: false, message: 'file not found' };
    }
    mapHostError(error);
  }
}

export async function listQuickPrompts(ctx: ProductHttpContext, hostId?: string): Promise<QuickPrompt[]> {
  const root = authorizedQuickPromptRoot(ctx);
  let listed: HostListFilesResult;
  try {
    const resolved = ctx.hostHub.resolveHostId(hostId);
    listed = await ctx.hostHub.callHostOnlineRpc<HostListFilesResult>({
      hostId: resolved,
      command: { type: 'host.list_files', roots: [root] }
    });
  } catch (error) {
    mapHostError(error);
  }
  const prompts: QuickPrompt[] = [];
  for (const file of listed.files) {
    if (file.kind !== 'file' || !file.relPath.endsWith('.json')) continue;
    if (!isSafeRelPath(file.relPath)) continue;
    try {
      const resolved = ctx.hostHub.resolveHostId(hostId);
      const body = await ctx.hostHub.callHostOnlineRpc<HostReadFileResult>({
        hostId: resolved,
        command: { type: 'host.read_file', root, relPath: file.relPath }
      });
      const parsed = JSON.parse(body.content) as Partial<QuickPrompt>;
      if (typeof parsed.id === 'string' && typeof parsed.label === 'string' && typeof parsed.prompt === 'string') {
        prompts.push({
          id: parsed.id,
          label: parsed.label,
          prompt: parsed.prompt,
          profile: parsed.profile,
          icon: parsed.icon,
          arguments: parsed.arguments,
          source: 'user'
        });
      }
    } catch {
      /* skip malformed prompt files */
    }
  }
  return prompts;
}

export { isSafeRelPath };
