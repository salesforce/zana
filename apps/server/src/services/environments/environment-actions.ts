import {
  getEnvironment,
  listEnvironmentsByProject,
  type EnvironmentRow
} from '@zana-ai/zcc-db';
import {
  environmentActionSchema,
  resolveEnvironmentMergeBaseBranch,
  workspaceDiffTargetSchema
} from '@zana-ai/zcc-domain';
import type { ProductHttpContext } from '../../http/product-context.js';
import { ThreadCreateError } from '../../http/thread-create.js';

function requireEnvironment(ctx: ProductHttpContext, id: string): EnvironmentRow {
  const environment = getEnvironment(ctx.db, id);
  if (!environment || environment.status === 'destroyed') {
    throw new ThreadCreateError(404, 'unknown-environment', 'environment is not registered');
  }
  if (!environment.path || environment.status !== 'ready') {
    throw new ThreadCreateError(409, 'environment_not_ready', 'environment is not ready');
  }
  return environment;
}

function workspaceContext(environment: EnvironmentRow) {
  return {
    workspacePath: environment.path!,
    workspaceProvisionType: environment.workspaceProvisionType
  };
}

export async function environmentStatus(ctx: ProductHttpContext, id: string) {
  const environment = requireEnvironment(ctx, id);
  return ctx.hostHub.callHostOnlineRpc({
    hostId: environment.hostId,
    command: { type: 'workspace.status', ...workspaceContext(environment) }
  });
}

const DIFF_FILES_MAX_FILES = 400;
const DIFF_PATCH_MAX_BYTES_PER_FILE = 64 * 1024;
const DIFF_PATCH_MAX_PATHS = 50;
const DIFF_FILE_AUTO_LOAD_MAX_CHANGED_LINES = 500;
const DIFF_FILE_TOO_LARGE_CHANGED_LINES = 20_000;
const DIFF_FILES_INLINE_PATCH_MAX_FILES = 10;

type HostDiffFilesResult = {
  files: Array<{
    path: string;
    previousPath: string | null;
    statusLetter: 'A' | 'M' | 'D' | 'R' | 'C' | 'T';
    additions: number;
    deletions: number;
    binary: boolean;
    origin: 'tracked' | 'untracked';
  }>;
  shortstat: string;
  mergeBaseRef: string | null;
  truncated: boolean;
};

type HostDiffPatchResult = {
  patches: Array<{ path: string; patch: string; truncated: boolean }>;
};

function parseDiffTarget(environment: EnvironmentRow, rawTarget: unknown) {
  const parsed = rawTarget
    ? workspaceDiffTargetSchema.safeParse(rawTarget)
    : { success: true as const, data: { type: 'uncommitted' as const } };
  if (!parsed.success) {
    throw new ThreadCreateError(400, 'invalid_diff_target', 'diff target is invalid');
  }
  let target = parsed.data;
  if ((target.type === 'branch_committed' || target.type === 'all') === false && target.type === 'uncommitted') {
    const mergeBase = resolveEnvironmentMergeBaseBranch(environment);
    if (mergeBase && rawTarget == null) {
      target = { type: 'all', mergeBaseBranch: mergeBase };
    }
  }
  return target;
}

function letterToChangeKind(letter: string): 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'type_changed' {
  switch (letter) {
    case 'A': return 'added';
    case 'M': return 'modified';
    case 'D': return 'deleted';
    case 'R': return 'renamed';
    case 'C': return 'copied';
    case 'T': return 'type_changed';
    default: return 'modified';
  }
}

function loadModeFor(stat: HostDiffFilesResult['files'][number]): 'auto' | 'on_demand' | 'too_large' {
  const changed = stat.additions + stat.deletions;
  if (changed > DIFF_FILE_TOO_LARGE_CHANGED_LINES) return 'too_large';
  if (stat.binary || changed > DIFF_FILE_AUTO_LOAD_MAX_CHANGED_LINES) return 'on_demand';
  return 'auto';
}

export async function environmentDiff(ctx: ProductHttpContext, id: string, rawTarget: unknown) {
  const environment = requireEnvironment(ctx, id);
  const target = parseDiffTarget(environment, rawTarget);
  return ctx.hostHub.callHostOnlineRpc({
    hostId: environment.hostId,
    command: { type: 'workspace.diff', ...workspaceContext(environment), target }
  });
}

export async function environmentDiffFiles(ctx: ProductHttpContext, id: string, rawTarget: unknown) {
  const environment = requireEnvironment(ctx, id);
  const target = parseDiffTarget(environment, rawTarget);
  const result = await ctx.hostHub.callHostOnlineRpc({
    hostId: environment.hostId,
    command: {
      type: 'workspace.diffFiles',
      ...workspaceContext(environment),
      target,
      maxFiles: DIFF_FILES_MAX_FILES
    }
  }) as HostDiffFilesResult;
  const files = result.files.map((stat) => ({
    path: stat.path,
    previousPath: stat.previousPath,
    changeKind: letterToChangeKind(stat.statusLetter),
    additions: stat.additions,
    deletions: stat.deletions,
    binary: stat.binary,
    origin: stat.origin,
    loadMode: loadModeFor(stat)
  }));
  const inlinePaths = files.length <= DIFF_FILES_INLINE_PATCH_MAX_FILES
    ? files.filter((file) => file.loadMode === 'auto').map((file) => file.path)
    : [];
  let initialPatches: HostDiffPatchResult['patches'] = [];
  if (inlinePaths.length > 0) {
    const patches = await ctx.hostHub.callHostOnlineRpc({
      hostId: environment.hostId,
      command: {
        type: 'workspace.diffPatch',
        ...workspaceContext(environment),
        target,
        paths: inlinePaths,
        maxBytesPerFile: DIFF_PATCH_MAX_BYTES_PER_FILE
      }
    }) as HostDiffPatchResult;
    initialPatches = patches.patches;
  }
  return {
    outcome: 'available' as const,
    files,
    truncated: result.truncated,
    shortstat: result.shortstat,
    mergeBaseRef: result.mergeBaseRef,
    initialPatches
  };
}

export async function environmentDiffPatch(ctx: ProductHttpContext, id: string, body: unknown) {
  const environment = requireEnvironment(ctx, id);
  const record = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  const paths = Array.isArray(record.paths) ? record.paths.filter((path): path is string => typeof path === 'string' && path.length > 0) : [];
  if (paths.length === 0 || paths.length > DIFF_PATCH_MAX_PATHS) {
    throw new ThreadCreateError(400, 'invalid_diff_paths', 'diff patch paths are invalid');
  }
  const target = parseDiffTarget(environment, record.target);
  const result = await ctx.hostHub.callHostOnlineRpc({
    hostId: environment.hostId,
    command: {
      type: 'workspace.diffPatch',
      ...workspaceContext(environment),
      target,
      paths,
      maxBytesPerFile: DIFF_PATCH_MAX_BYTES_PER_FILE
    }
  }) as HostDiffPatchResult;
  return {
    outcome: 'available' as const,
    patches: result.patches
  };
}

export async function environmentPullRequest(ctx: ProductHttpContext, id: string) {
  const environment = requireEnvironment(ctx, id);
  return ctx.hostHub.callHostOnlineRpc({
    hostId: environment.hostId,
    command: { type: 'workspace.pull_request', ...workspaceContext(environment) }
  });
}

export async function runEnvironmentAction(ctx: ProductHttpContext, id: string, body: unknown) {
  const environment = requireEnvironment(ctx, id);
  const parsed = environmentActionSchema.safeParse(body);
  if (!parsed.success) {
    throw new ThreadCreateError(400, 'invalid_action', 'environment action is invalid');
  }
  const ctxArgs = workspaceContext(environment);
  switch (parsed.data.action) {
    case 'commit': {
      const message = parsed.data.message ?? `ZCC commit on ${environment.branchName ?? 'workspace'}`;
      const result = await ctx.hostHub.callHostOnlineRpc({
        hostId: environment.hostId,
        command: { type: 'workspace.commit', ...ctxArgs, message }
      });
      return { ok: true as const, action: 'commit' as const, ...(result as object) };
    }
    case 'squash_merge': {
      const result = await ctx.hostHub.callHostOnlineRpc({
        hostId: environment.hostId,
        command: {
          type: 'workspace.squash_merge',
          ...ctxArgs,
          targetBranch: parsed.data.targetBranch,
          message: parsed.data.message ?? `Squash merge ${environment.branchName ?? 'branch'}`
        }
      });
      return { ok: true as const, action: 'squash_merge' as const, ...(result as object) };
    }
    case 'pull_request_ready':
      await ctx.hostHub.callHostOnlineRpc({
        hostId: environment.hostId,
        command: { type: 'workspace.pull_request_ready', ...ctxArgs }
      });
      return { ok: true as const, action: 'pull_request_ready' as const, message: 'pull request marked ready' };
    case 'pull_request_draft':
      await ctx.hostHub.callHostOnlineRpc({
        hostId: environment.hostId,
        command: { type: 'workspace.pull_request_draft', ...ctxArgs }
      });
      return { ok: true as const, action: 'pull_request_draft' as const, message: 'pull request marked draft' };
    case 'pull_request_merge':
      await ctx.hostHub.callHostOnlineRpc({
        hostId: environment.hostId,
        command: { type: 'workspace.pull_request_merge', ...ctxArgs, method: parsed.data.method }
      });
      return { ok: true as const, action: 'pull_request_merge' as const, method: parsed.data.method, message: 'pull request merged' };
    case 'pull_request_create': {
      const result = await ctx.hostHub.callHostOnlineRpc({
        hostId: environment.hostId,
        command: {
          type: 'workspace.pull_request_create',
          ...ctxArgs,
          title: parsed.data.title,
          body: parsed.data.body,
          base: parsed.data.base,
          draft: parsed.data.draft
        }
      });
      return { ok: true as const, action: 'pull_request_create' as const, ...(result as object) };
    }
  }
}

export function listProjectEnvironments(ctx: ProductHttpContext, projectId: string, hostId?: string): EnvironmentRow[] {
  return listEnvironmentsByProject(ctx.db, projectId, hostId);
}
