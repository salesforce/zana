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

export async function environmentDiff(ctx: ProductHttpContext, id: string, rawTarget: unknown) {
  const environment = requireEnvironment(ctx, id);
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
  return ctx.hostHub.callHostOnlineRpc({
    hostId: environment.hostId,
    command: { type: 'workspace.diff', ...workspaceContext(environment), target }
  });
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
