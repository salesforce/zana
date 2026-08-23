import type { ZccDatabase } from '../connection.js';
import { createEnvironmentId } from '../ids.js';

export type EnvironmentStatus =
  | 'provisioning'
  | 'ready'
  | 'retiring'
  | 'failed'
  | 'destroying'
  | 'destroyed';
export type WorkspaceProvisionType = 'unmanaged' | 'managed-worktree' | 'personal';

export interface EnvironmentRow {
  id: string;
  name: string | null;
  projectId: string;
  hostId: string;
  path: string | null;
  managed: boolean;
  isGitRepo: boolean;
  isWorktree: boolean;
  workspaceProvisionType: WorkspaceProvisionType;
  branchName: string | null;
  baseBranch: string | null;
  defaultBranch: string | null;
  mergeBaseBranch: string | null;
  status: EnvironmentStatus;
  createdAt: number;
  updatedAt: number;
}

interface EnvironmentSqlRow {
  id: string;
  name: string | null;
  project_id: string;
  host_id: string;
  path: string | null;
  managed: number;
  is_git_repo: number;
  is_worktree: number;
  workspace_provision_type: WorkspaceProvisionType;
  branch_name: string | null;
  base_branch: string | null;
  default_branch: string | null;
  merge_base_branch: string | null;
  status: EnvironmentStatus;
  created_at: number;
  updated_at: number;
}

function toEnvironment(row: EnvironmentSqlRow): EnvironmentRow {
  return {
    id: row.id,
    name: row.name,
    projectId: row.project_id,
    hostId: row.host_id,
    path: row.path,
    managed: row.managed === 1,
    isGitRepo: row.is_git_repo === 1,
    isWorktree: row.is_worktree === 1,
    workspaceProvisionType: row.workspace_provision_type,
    branchName: row.branch_name,
    baseBranch: row.base_branch,
    defaultBranch: row.default_branch,
    mergeBaseBranch: row.merge_base_branch,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function createEnvironment(
  db: ZccDatabase,
  input: {
    id?: string;
    name?: string | null;
    projectId: string;
    hostId: string;
    path?: string | null;
    managed?: boolean;
    isGitRepo?: boolean;
    isWorktree?: boolean;
    workspaceProvisionType?: WorkspaceProvisionType;
    branchName?: string | null;
    baseBranch?: string | null;
    defaultBranch?: string | null;
    mergeBaseBranch?: string | null;
    status?: EnvironmentStatus;
  }
): EnvironmentRow {
  const now = Date.now();
  const id = input.id ?? createEnvironmentId();
  const provisionType = input.workspaceProvisionType ?? 'unmanaged';
  db.sqlite.prepare(
    `INSERT INTO environments (
        id, name, project_id, host_id, path, managed, is_git_repo, is_worktree,
        workspace_provision_type, branch_name, base_branch, default_branch, merge_base_branch,
        status, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.name ?? null,
    input.projectId,
    input.hostId,
    input.path ?? null,
    (input.managed ?? provisionType !== 'unmanaged') ? 1 : 0,
    input.isGitRepo ? 1 : 0,
    input.isWorktree ? 1 : 0,
    provisionType,
    input.branchName ?? null,
    input.baseBranch ?? null,
    input.defaultBranch ?? null,
    input.mergeBaseBranch ?? null,
    input.status ?? 'provisioning',
    now,
    now
  );
  return getEnvironment(db, id)!;
}

export function getEnvironment(db: ZccDatabase, id: string): EnvironmentRow | null {
  const row = db.sqlite.prepare('SELECT * FROM environments WHERE id = ?').get(id) as EnvironmentSqlRow | undefined;
  return row ? toEnvironment(row) : null;
}

export function listEnvironmentsByProject(db: ZccDatabase, projectId: string, hostId?: string): EnvironmentRow[] {
  if (hostId) {
    return (db.sqlite.prepare(
      `SELECT * FROM environments
       WHERE project_id = ? AND host_id = ? AND status NOT IN ('destroyed')
       ORDER BY updated_at DESC`
    ).all(projectId, hostId) as EnvironmentSqlRow[]).map(toEnvironment);
  }
  return (db.sqlite.prepare(
    `SELECT * FROM environments
     WHERE project_id = ? AND status NOT IN ('destroyed')
     ORDER BY updated_at DESC`
  ).all(projectId) as EnvironmentSqlRow[]).map(toEnvironment);
}

export function findProjectEnvironmentByHostPath(
  db: ZccDatabase,
  projectId: string,
  hostId: string,
  path: string
): EnvironmentRow | null {
  const row = db.sqlite.prepare(
    `SELECT * FROM environments
     WHERE project_id = ? AND host_id = ? AND path = ? AND status NOT IN ('destroyed')
     LIMIT 1`
  ).get(projectId, hostId, path) as EnvironmentSqlRow | undefined;
  return row ? toEnvironment(row) : null;
}

export function findForeignManagedEnvironmentAtHostPath(
  db: ZccDatabase,
  args: { hostId: string; path: string; projectId: string }
): EnvironmentRow | null {
  const row = db.sqlite.prepare(
    `SELECT * FROM environments
     WHERE host_id = ? AND path = ? AND project_id != ? AND managed = 1 AND status NOT IN ('destroyed')
     LIMIT 1`
  ).get(args.hostId, args.path, args.projectId) as EnvironmentSqlRow | undefined;
  return row ? toEnvironment(row) : null;
}

export function hasLiveThreadAtHostPath(
  db: ZccDatabase,
  args: { hostId: string; path: string }
): boolean {
  const row = db.sqlite.prepare(
    `SELECT 1 AS found
     FROM legacy_agent_sessions t
     JOIN environments e ON e.id = t.environment_id
     WHERE e.host_id = ? AND e.path = ? AND t.status IN ('starting', 'running')
     LIMIT 1`
  ).get(args.hostId, args.path) as { found: number } | undefined;
  return Boolean(row);
}

export function countLiveThreadsForEnvironment(db: ZccDatabase, environmentId: string): number {
  const legacy = db.sqlite.prepare(
    `SELECT COUNT(*) AS n FROM legacy_agent_sessions
     WHERE environment_id = ? AND status IN ('starting', 'running')`
  ).get(environmentId) as { n: number };
  const live = db.sqlite.prepare(
    `SELECT COUNT(*) AS n FROM threads
     WHERE environment_id = ? AND archived_at IS NULL AND status IN ('starting', 'active', 'stopping')`
  ).get(environmentId) as { n: number };
  return legacy.n + live.n;
}

export function updateEnvironmentStatus(
  db: ZccDatabase,
  id: string,
  status: EnvironmentStatus,
  path?: string
): EnvironmentRow | null {
  const now = Date.now();
  if (path !== undefined) {
    db.sqlite.prepare('UPDATE environments SET status = ?, path = ?, updated_at = ? WHERE id = ?').run(
      status,
      path,
      now,
      id
    );
  } else {
    db.sqlite.prepare('UPDATE environments SET status = ?, updated_at = ? WHERE id = ?').run(status, now, id);
  }
  return getEnvironment(db, id);
}

export function updateEnvironmentDiscovery(
  db: ZccDatabase,
  id: string,
  patch: {
    status?: EnvironmentStatus;
    path?: string | null;
    isGitRepo?: boolean;
    isWorktree?: boolean;
    branchName?: string | null;
    baseBranch?: string | null;
    defaultBranch?: string | null;
    mergeBaseBranch?: string | null;
    name?: string | null;
  }
): EnvironmentRow | null {
  const current = getEnvironment(db, id);
  if (!current) return null;
  const now = Date.now();
  db.sqlite.prepare(
    `UPDATE environments SET
        status = ?, path = ?, is_git_repo = ?, is_worktree = ?,
        branch_name = ?, base_branch = ?, default_branch = ?, merge_base_branch = ?,
        name = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    patch.status ?? current.status,
    patch.path !== undefined ? patch.path : current.path,
    (patch.isGitRepo ?? current.isGitRepo) ? 1 : 0,
    (patch.isWorktree ?? current.isWorktree) ? 1 : 0,
    patch.branchName !== undefined ? patch.branchName : current.branchName,
    patch.baseBranch !== undefined ? patch.baseBranch : current.baseBranch,
    patch.defaultBranch !== undefined ? patch.defaultBranch : current.defaultBranch,
    patch.mergeBaseBranch !== undefined ? patch.mergeBaseBranch : current.mergeBaseBranch,
    patch.name !== undefined ? patch.name : current.name,
    now,
    id
  );
  return getEnvironment(db, id);
}
