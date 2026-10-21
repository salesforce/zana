import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { resolveContainedReal } from '@zana-ai/zcc-path-confine';
import type { CcApi } from '@zana-ai/zcc-desktop-contract';
import type { Project } from '@zana-ai/zcc-domain/product';

type Request = Parameters<CcApi['openers']['fileLocation']>[0];
type Location = Awaited<ReturnType<CcApi['openers']['fileLocation']>>;
export interface PreviewFileLocationDeps {
  dataDir: string;
  localHostId: string | undefined;
  projects: Project[];
  thread(id: string): Promise<{ hostId: string; cwd: string | null; projectId?: string } | null>;
  trustedRoot(root: string): Promise<string | null>;
}

async function containedPath(root: string, candidate: string): Promise<string | null> {
  const path = await resolveContainedReal(root, candidate);
  if (path) return path;
  const canonicalRoot = await realpath(root).catch(() => null);
  return canonicalRoot ? resolveContainedReal(canonicalRoot, candidate) : null;
}

/** Never use the renderer's path as an OS opener argument until confined to a main-owned root. */
export async function previewFileLocation(input: Request, deps: PreviewFileLocationDeps): Promise<Location> {
  const unavailable = { ok: false, message: 'This file is not available on this computer.' };
  if (!input || typeof input.path !== 'string' || !input.path || input.path.length > 32_768
    || input.path.includes('\0') || !['workspace', 'thread-storage'].includes(input.source)
    || (input.projectId !== undefined && typeof input.projectId !== 'string')
    || (input.threadId !== undefined && (typeof input.threadId !== 'string'
      || !/^[A-Za-z0-9_-][A-Za-z0-9._-]{0,255}$/.test(input.threadId)))) return unavailable;
  try {
    const projects = deps.projects.filter(project => !project.remote && (!project.hostId || project.hostId === deps.localHostId));
    let root: string | null = null;
    if (input.source === 'thread-storage') {
      if (!input.threadId || !await deps.thread(input.threadId)) return unavailable;
      // Confine the thread directory too: it must not be a symlink outside storage.
      root = await resolveContainedReal(join(deps.dataDir, 'thread-storage'), input.threadId);
    } else if (input.threadId) {
      const thread = await deps.thread(input.threadId);
      if (thread) {
        if (!deps.localHostId || thread.hostId !== deps.localHostId || !thread.cwd
          || (thread.projectId && !projects.some(project => project.id === thread.projectId))) return unavailable;
        root = await deps.trustedRoot(thread.cwd);
      } else {
        // CLI preview panels have a PTY id rather than a conversation row.
        root = projects.find(project => project.id === input.projectId)?.path ?? null;
      }
    } else if (input.projectId) {
      root = projects.find(project => project.id === input.projectId)?.path ?? null;
    } else if (isAbsolute(input.path)) {
      for (const project of projects) {
        const candidate = await containedPath(project.path, input.path);
        if (candidate && (await stat(candidate)).isFile()) return { ok: true, path: candidate };
      }
    }
    if (!root) return unavailable;
    const path = await containedPath(root, input.path);
    if (!path || !(await stat(path)).isFile()) return unavailable;
    return { ok: true, path };
  } catch {
    return unavailable;
  }
}
