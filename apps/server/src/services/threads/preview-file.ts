import { isAbsolute } from 'node:path';
import {
  threadOpenSignalSchema,
  type PanelFileSource,
  type ThreadOpenSignal,
  type ThreadOpenSplit
} from '@zana-ai/zcc-server-contract';
import { getConversationThread, getEnvironment } from '@zana-ai/zcc-db';
import { isSafeRelPath } from '../../http/library-via-host.js';
import type { ProductHttpContext } from '../../http/product-context.js';
import { threadStorageRoot } from './thread-storage.js';
import { confinePathToRoot } from './thread-path-confine.js';

export class PreviewFileError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'PreviewFileError';
  }
}

export interface PreviewFileInput {
  threadId: string;
  /** Used when `threadId` is a PTY/session panel owner, not a conversation thread. */
  projectId?: string;
  split?: ThreadOpenSplit;
  source: PanelFileSource;
  path: string;
  lineNumber?: number | null;
}

export interface PreviewFileResult {
  delivered: number;
  path: string;
  source: PanelFileSource;
  threadId: string;
  projectId: string;
}

export interface PreviewFileDeps {
  dataDir: string;
  getThread(id: string): { id: string; projectId: string; environmentId: string | null } | null;
  getEnvironmentPath(environmentId: string): string | null;
  getProjectPath(projectId: string): string | null;
  emit(payload: ThreadOpenSignal): number;
}

export function previewFileDepsFromContext(ctx: ProductHttpContext): PreviewFileDeps {
  return {
    dataDir: ctx.dataDir,
    getThread: (id) => getConversationThread(ctx.db, id),
    getEnvironmentPath: (environmentId) => getEnvironment(ctx.db, environmentId)?.path ?? null,
    getProjectPath: (projectId) => ctx.toProjects().find((project) => project.id === projectId)?.path ?? null,
    emit: (payload) => {
      ctx.hub.emit('threads:open', payload);
      return ctx.hub.size();
    }
  };
}

function confineCandidate(
  root: string | null,
  candidate: string,
  missingRootCode: string,
  missingRootMessage: string,
  escapeMessage: string
): string {
  if (!root || !isAbsolute(root)) {
    throw new PreviewFileError(409, missingRootCode, missingRootMessage);
  }
  const confined = confinePathToRoot(root, candidate);
  if (!confined || !isSafeRelPath(confined)) {
    throw new PreviewFileError(403, 'path-escape', escapeMessage);
  }
  return confined;
}

/**
 * Confine a workspace or thread-storage path and broadcast `threads:open` so the
 * visible side panel opens a file-preview tab. Conversation threads confine
 * against the environment checkout; unknown ids (PTY session panel owners) fall
 * back to the registered project path when `projectId` is supplied.
 */
export function openThreadFilePreview(deps: PreviewFileDeps, input: PreviewFileInput): PreviewFileResult {
  const thread = deps.getThread(input.threadId);
  const projectId = thread?.projectId ?? input.projectId;
  if (!projectId) {
    throw new PreviewFileError(404, 'unknown-thread', 'thread is not registered');
  }
  if (!thread && !deps.getProjectPath(projectId)) {
    throw new PreviewFileError(404, 'unknown-project', 'project is not registered');
  }

  const confined = input.source === 'thread-storage'
    ? confineCandidate(
      threadStorageRoot(deps.dataDir, input.threadId),
      input.path,
      'path-escape',
      'thread storage root is not available',
      'path is not inside thread storage'
    )
    : confineCandidate(
      thread
        ? (thread.environmentId ? deps.getEnvironmentPath(thread.environmentId) : null)
        : deps.getProjectPath(projectId),
      input.path,
      thread ? 'environment_not_ready' : 'cwd-escape',
      thread ? 'environment is not provisioned' : 'project path is not a confined directory',
      'path is not inside the thread workspace'
    );

  const lineNumber = typeof input.lineNumber === 'number' && input.lineNumber > 0
    ? input.lineNumber
    : null;
  const signal = threadOpenSignalSchema.parse({
    type: 'thread-open',
    projectId,
    threadId: thread?.id ?? input.threadId,
    split: input.split ?? 'right',
    file: {
      source: input.source,
      path: confined,
      lineNumber
    }
  });
  const delivered = deps.emit(signal);
  return {
    delivered,
    path: confined,
    source: input.source,
    threadId: signal.threadId,
    projectId
  };
}
