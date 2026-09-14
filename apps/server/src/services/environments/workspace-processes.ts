import { getEnvironment, type EnvironmentRow } from '@zana-ai/zcc-db';
import type {
  WorkspaceProcessesKillResult,
  WorkspaceProcessesListResult
} from '@zana-ai/zcc-contracts/host-rpc';
import type { ProductHttpContext } from '../../http/product-context.js';
import { ThreadCreateError } from '../../http/thread-create.js';

const PROCESS_PID_CAP = 200;

export type WorkspaceProcessScope =
  | { kind: 'project'; projectId: string }
  | { kind: 'environment'; environmentId: string };

function requireReadyEnvironment(ctx: ProductHttpContext, id: string): EnvironmentRow {
  const environment = getEnvironment(ctx.db, id);
  if (!environment || environment.status === 'destroyed') {
    throw new ThreadCreateError(404, 'unknown-environment', 'environment is not registered');
  }
  if (!environment.path || environment.status !== 'ready') {
    throw new ThreadCreateError(409, 'environment_not_ready', 'environment is not ready');
  }
  return environment;
}

function resolveWorkspace(ctx: ProductHttpContext, scope: WorkspaceProcessScope): {
  hostId: string;
  workspacePath: string;
  workspaceProvisionType: EnvironmentRow['workspaceProvisionType'];
} {
  if (scope.kind === 'environment') {
    const environment = requireReadyEnvironment(ctx, scope.environmentId);
    return {
      hostId: environment.hostId,
      workspacePath: environment.path!,
      workspaceProvisionType: environment.workspaceProvisionType
    };
  }
  const project = ctx.toProjects().find((row) => row.id === scope.projectId);
  if (!project?.path) {
    throw new ThreadCreateError(404, 'unknown-project', 'project is not registered');
  }
  return {
    hostId: ctx.hostHub.resolveHostId(project.hostId),
    workspacePath: project.path,
    workspaceProvisionType: 'unmanaged'
  };
}

export function parseKillPids(body: unknown): number[] {
  const record = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  const raw = record.pids;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > PROCESS_PID_CAP) {
    throw new ThreadCreateError(400, 'invalid-pids', 'pids must be a non-empty list of process ids');
  }
  const pids: number[] = [];
  for (const value of raw) {
    if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
      throw new ThreadCreateError(400, 'invalid-pids', 'pids must be a non-empty list of process ids');
    }
    pids.push(value);
  }
  return pids;
}

export async function listWorkspaceProcesses(
  ctx: ProductHttpContext,
  scope: WorkspaceProcessScope
): Promise<WorkspaceProcessesListResult> {
  const workspace = resolveWorkspace(ctx, scope);
  return ctx.hostHub.callHostOnlineRpc({
    hostId: workspace.hostId,
    command: {
      type: 'workspace.processes.list',
      workspacePath: workspace.workspacePath,
      workspaceProvisionType: workspace.workspaceProvisionType
    }
  }) as Promise<WorkspaceProcessesListResult>;
}

export async function killWorkspaceProcesses(
  ctx: ProductHttpContext,
  scope: WorkspaceProcessScope,
  body: unknown
): Promise<WorkspaceProcessesKillResult> {
  const pids = parseKillPids(body);
  const workspace = resolveWorkspace(ctx, scope);
  return ctx.hostHub.callHostOnlineRpc({
    hostId: workspace.hostId,
    command: {
      type: 'workspace.processes.kill',
      workspacePath: workspace.workspacePath,
      workspaceProvisionType: workspace.workspaceProvisionType,
      pids
    }
  }) as Promise<WorkspaceProcessesKillResult>;
}
