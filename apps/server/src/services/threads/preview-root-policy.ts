import { realpathSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { getPrimaryHost, type ZccDatabase } from '@zana-ai/zcc-db';
import { openContainedFile, type ContainedFile } from '@zana-ai/zcc-path-confine';
import type { AppConfig, Project } from '@zana-ai/zcc-domain/product';
import { isSafeRelPath } from '../../http/library-via-host.js';
import { confinePathToRoot } from './thread-path-confine.js';
import { threadLocalPreviewRoots } from './thread-preview-roots.js';

/**
 * One policy for every server-side gate that reads a file by absolute path
 * (preview open, path resolution, content, media routes).
 *
 * Effective roots are the server-owned roots (thread storage, project attachments,
 * app artifacts) plus, for local desktop targets only, the folders the user trusted
 * in Settings. A trusted folder is never offered to a remote thread or machine.
 *
 * Containment policy for every access:
 *  - the root and the requested file are resolved with realpath;
 *  - the resolved file must be a regular file inside the resolved root on a
 *    path boundary (not a string prefix);
 *  - a symlink is accepted only when its final resolved target stays inside
 *    the root; escaping, dangling and looping links, missing roots, missing
 *    files, directories, FIFOs and devices are refused;
 *  - the file is opened once (no-follow, descriptor re-validated against the
 *    root) and the caller reads that same descriptor, so swapping a path
 *    component after the check cannot redirect the read.
 */
export interface PreviewRoot {
  path: string;
  /** User-trusted folder, as opposed to a server-owned root. */
  trusted: boolean;
}

export interface RootsContext {
  dataDir: string;
  db: ZccDatabase;
  config?: { getConfig(): Pick<AppConfig, 'trustedPreviewFolders'> };
  toProjects?(): Project[];
}

/** True when the thread's host is this desktop's own (primary) host. */
export function isLocalDesktopHost(db: ZccDatabase, hostId: string | null | undefined): boolean {
  if (!hostId) return false;
  return getPrimaryHost(db)?.id === hostId;
}

/** Trusted folders for this target; always empty for remote threads and machines. */
export function trustedFoldersForTarget(
  ctx: Pick<RootsContext, 'db' | 'config' | 'toProjects'>,
  target: { thread: { hostId?: string | null } | null; projectId: string | null | undefined }
): string[] {
  const configured = ctx.config?.getConfig?.().trustedPreviewFolders;
  if (!configured?.length) return [];
  const project = target.projectId ? ctx.toProjects?.().find((row) => row.id === target.projectId) : undefined;
  // A project that is not found, or is reached over SSH, never gets desktop-local folders.
  if (target.projectId && (!project || project.remote)) return [];
  if (target.thread) return isLocalDesktopHost(ctx.db, target.thread.hostId) ? [...configured] : [];
  if (!project) return [];
  return !project.hostId || isLocalDesktopHost(ctx.db, project.hostId) ? [...configured] : [];
}

export function effectivePreviewRoots(
  dataDir: string,
  projectId: string | null | undefined,
  trustedFolders: readonly string[],
  threadId?: string
): PreviewRoot[] {
  return [
    ...threadLocalPreviewRoots(dataDir, projectId, threadId).map((path) => ({ path, trusted: false })),
    ...trustedFolders.map((path) => ({ path, trusted: true }))
  ];
}

export function effectivePreviewRootsFor(
  ctx: RootsContext,
  target: { thread: { id?: string; hostId?: string | null } | null; projectId: string | null | undefined },
  /** Project whose attachment directory is a server-owned root; defaults to the target project. */
  attachmentProjectId: string | null | undefined = target.projectId
): PreviewRoot[] {
  return effectivePreviewRoots(ctx.dataDir, attachmentProjectId, trustedFoldersForTarget(ctx, target), target.thread?.id);
}

export interface RootMatch {
  root: string;
  /** The root came from the user's trusted folders and must stay canonical through the open. */
  trusted: boolean;
  /** Candidate relative to `root`, already safe. */
  rel: string;
}

function realOrNull(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

async function realOrNullAsync(path: string): Promise<string | null> {
  try {
    return await realpath(path);
  } catch {
    return null;
  }
}

/** Candidate relative to `root`, when safe. A trusted root has already been verified canonical. */
function relUnder(root: string, candidate: string): string | null {
  const rel = confinePathToRoot(root, candidate);
  return rel && isSafeRelPath(rel) ? rel : null;
}

/**
 * Roots that contain `candidate`. A trusted root is honored only while it still
 * resolves to the canonical directory the user picked (a root swapped for a
 * symlink no longer anchors), and then also matches through the candidate's
 * realpath, because a message can name a file through a symlinked directory.
 * The open that follows re-validates against the same root.
 */
export function matchPreviewRoots(roots: readonly PreviewRoot[], candidate: string): RootMatch[] {
  const matches: RootMatch[] = [];
  for (const { path, trusted } of roots) {
    if (trusted && realOrNull(path) !== path) continue;
    let rel = relUnder(path, candidate);
    if (!rel && trusted) {
      const realCandidate = realOrNull(candidate);
      rel = realCandidate ? relUnder(path, realCandidate) : null;
    }
    if (rel) matches.push({ root: path, rel, trusted });
  }
  return matches;
}

/** Async twin of {@link matchPreviewRoots}; keeps a hung network folder off the event loop. */
export async function matchPreviewRootsAsync(roots: readonly PreviewRoot[], candidate: string): Promise<RootMatch[]> {
  const matches: RootMatch[] = [];
  for (const { path, trusted } of roots) {
    if (trusted && (await realOrNullAsync(path)) !== path) continue;
    let rel = relUnder(path, candidate);
    if (!rel && trusted) {
      const realCandidate = await realOrNullAsync(candidate);
      rel = realCandidate ? relUnder(path, realCandidate) : null;
    }
    if (rel) matches.push({ root: path, rel, trusted });
  }
  return matches;
}

export type LocalPreviewOpen =
  | { kind: 'opened'; file: ContainedFile; root: string; rel: string }
  /** A root contains the path but the file is not an openable regular file inside it. */
  | { kind: 'missing' }
  /** No effective root contains the path. */
  | { kind: 'outside' };

/** Authorize and open (once) a file under the effective roots. The caller closes `file.handle`. */
export async function openLocalPreviewFile(roots: readonly PreviewRoot[], candidate: string): Promise<LocalPreviewOpen> {
  const matches = await matchPreviewRootsAsync(roots, candidate);
  for (const { root, rel, trusted } of matches) {
    const file = await openContainedFile(root, rel, trusted ? { expectedRoot: root } : {});
    if (file) return { kind: 'opened', file, root, rel };
  }
  return matches.length ? { kind: 'missing' } : { kind: 'outside' };
}
