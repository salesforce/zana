import { posix } from 'node:path';
import { z } from 'zod';
import { getPrimaryHost, listEnvironmentsByProject } from '@zana-ai/zcc-db';
import type { GitBranch, GitFileCode, GitStatus, WorkspaceStatus, Worktree } from '@zana-ai/zcc-domain/product';
import type { ProductHttpContext } from './product-context.js';
import { authorizeScopedPath, parseProjectFileScope, ProjectFsError } from './project-fs-via-host.js';
import { resolveProjectHost } from './project-host.js';
import { isSafeRelPath } from './library-via-host.js';
import { cachedWorkspaceStatus } from '../services/environments/workspace-status-cache.js';

const inputSchema = z.object({
  operation: z.enum(['status', 'head', 'discard', 'branches', 'worktrees']),
  path: z.string().min(1).max(4096), scope: z.unknown().optional(),
  expectedSha256: z.string().regex(/^[a-f0-9]{64}$/).nullable().optional()
}).strict();
/** Resolve Git authority exactly as file access; no host/root from the caller is trusted. */
export async function projectGit(ctx: ProductHttpContext, input: unknown) {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) throw new ProjectFsError(400, 'invalid-git-operation', 'Invalid Git operation');
  const body = parsed.data, scope = parseProjectFileScope(body.scope);
  const source = authorizeScopedPath(ctx, body.path, scope);
  if (!source || (source.relPath && !isSafeRelPath(source.relPath))) throw new ProjectFsError(403, 'path-escape', 'Choose a path in the selected checkout');
  const hostId = resolveProjectHost(ctx, source.hostId);
  if (body.operation === 'head' || body.operation === 'discard') {
    if (!source.relPath) throw new ProjectFsError(400, 'invalid-file', 'Choose one file');
    if (body.operation === 'discard' && body.expectedSha256 === undefined) throw new ProjectFsError(409, 'revision-required', 'Refresh the file before discarding it');
    return ctx.hostHub.callHostOnlineRpc({ hostId, command: body.operation === 'head'
      ? { type: 'host.git_file', operation: 'head', root: source.root, path: body.path }
      : { type: 'host.git_file', operation: 'discard', root: source.root, path: body.path, expectedSha256: body.expectedSha256! } });
  }
  if (body.operation === 'worktrees') {
    const projectId = scope?.projectId ?? ctx.toProjects().find(project => project.path === source.root && (project.hostId ?? getPrimaryHost(ctx.db)?.id) === hostId)?.id;
    if (!projectId) return [];
    const base = [{ path: source.root, branch: null, head: null, bare: false, detached: false, isMain: true } satisfies Worktree];
    if (scope?.environmentId) return base;
    return [...base, ...listEnvironmentsByProject(ctx.db, projectId, hostId)
      .filter(environment => environment.path && environment.status === 'ready' && environment.workspaceProvisionType === 'managed-worktree')
      .map(environment => ({ path: environment.path!, branch: environment.branchName, head: null, bare: false, detached: !environment.branchName, isMain: false } satisfies Worktree))];
  }
  const status = await cachedWorkspaceStatus<WorkspaceStatus>(ctx, { hostId, workspacePath: source.root, workspaceProvisionType: 'unmanaged' });
  if (body.operation === 'branches') {
    if (!status.isGitRepo) return [];
    const result = await ctx.hostHub.callHostOnlineRpc<{ branches: string[] }>({ hostId, command: { type: 'host.list_branches', workspacePath: source.root, workspaceProvisionType: 'unmanaged', limit: 500 } });
    return result.branches.map(name => ({ name, current: name === status.branchName } satisfies GitBranch));
  }
  if (!status.isGitRepo) return null;
  const codes = { untracked: '?', added: 'A', modified: 'M', deleted: 'D', renamed: 'R', copied: 'C', typechange: 'M' } as const;
  const files: Record<string, GitFileCode> = {};
  for (const file of status.files) if (isSafeRelPath(file.path)) files[posix.join(source.root, file.path)] = codes[file.kind];
  return { branch: status.branchName, detached: status.checkout.kind === 'detached', ahead: status.ahead ?? 0, behind: status.behind ?? 0, dirty: status.dirty, toplevel: source.root, files } satisfies GitStatus;
}
