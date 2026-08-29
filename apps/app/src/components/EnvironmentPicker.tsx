import { useEffect, useState, type ReactNode } from 'react';
import { FolderGit2, GitBranch, GitFork, Laptop } from 'lucide-react';
import type { Environment, SpawnEnvironmentChoice } from '@zana-ai/zcc-domain';
import { product } from '../lib/product-client.js';
import { apiJson } from '../lib/fetch-with-app-surface.js';
import { PopoverPicklist } from './ui/PopoverPicklist.js';

export type WorkspacePickerValue = SpawnEnvironmentChoice;

export const NEW_WORKTREE_DISABLED_REASON =
  'New worktrees require a Git repository with at least one commit';
export const EXISTING_WORKTREE_DISABLED_REASON = 'No worktrees in this project yet';

export function workspaceToSpawnChoice(value: WorkspacePickerValue): SpawnEnvironmentChoice {
  return value;
}

export function defaultWorkspaceChoice(isolateByDefault: boolean): WorkspacePickerValue {
  return isolateByDefault ? { kind: 'worktree' } : { kind: 'unmanaged' };
}

export function resolveNewWorktreeDisabledReason(branches: readonly string[]): string | null {
  return branches.length === 0 ? NEW_WORKTREE_DISABLED_REASON : null;
}

export function resolveExistingWorktreeDisabledReason(count: number): string | null {
  return count === 0 ? EXISTING_WORKTREE_DISABLED_REASON : null;
}

export function snapWorkspaceChoice(
  value: WorkspacePickerValue,
  args: {
    newWorktreeDisabled: boolean;
    existingWorktreeDisabled: boolean;
    reuseIds?: readonly string[];
  }
): WorkspacePickerValue {
  if (value.kind === 'worktree' && args.newWorktreeDisabled) return { kind: 'unmanaged' };
  if (value.kind !== 'reuse') return value;
  if (args.existingWorktreeDisabled) return { kind: 'unmanaged' };
  const ids = args.reuseIds ?? [];
  if (ids.length > 0 && !ids.includes(value.environmentId)) {
    return { kind: 'reuse', environmentId: ids[0]! };
  }
  return value;
}

function workspaceChoiceChanged(left: WorkspacePickerValue, right: WorkspacePickerValue): boolean {
  if (left.kind !== right.kind) return true;
  if (left.kind === 'reuse' && right.kind === 'reuse') return left.environmentId !== right.environmentId;
  return false;
}

function WorkspaceTriggerIcon({ kind }: { kind: WorkspacePickerValue['kind'] }): ReactNode {
  if (kind === 'worktree') return <GitBranch size={14} aria-hidden="true" />;
  if (kind === 'reuse') return <GitFork size={14} aria-hidden="true" />;
  if (kind === 'personal') return <FolderGit2 size={14} aria-hidden="true" />;
  return <Laptop size={14} aria-hidden="true" />;
}

interface Props {
  projectId: string;
  value: WorkspacePickerValue;
  onChange: (value: WorkspacePickerValue) => void;
  allowPersonal?: boolean;
  disabled?: boolean;
}

export function EnvironmentPicker({ projectId, value, onChange, allowPersonal, disabled }: Props) {
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [environmentsLoaded, setEnvironmentsLoaded] = useState(false);
  const [branches, setBranches] = useState<string[]>([]);
  const [branchesLoaded, setBranchesLoaded] = useState(false);

  useEffect(() => {
    if (!projectId) {
      setEnvironments([]);
      setEnvironmentsLoaded(true);
      return;
    }
    let cancelled = false;
    setEnvironmentsLoaded(false);
    void product.environments.list(projectId).then((rows) => {
      if (!cancelled) {
        setEnvironments(rows.filter((row) => row.status === 'ready' && row.workspaceProvisionType === 'managed-worktree'));
        setEnvironmentsLoaded(true);
      }
    }).catch(() => {
      if (!cancelled) {
        setEnvironments([]);
        setEnvironmentsLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    if (!projectId) {
      setBranches([]);
      setBranchesLoaded(true);
      return;
    }
    let cancelled = false;
    setBranchesLoaded(false);
    void apiJson<{ branches: string[] }>(`/projects/${encodeURIComponent(projectId)}/branches`)
      .then((body) => {
        if (!cancelled) {
          setBranches(body.branches);
          setBranchesLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBranches([]);
          setBranchesLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const newWorktreeDisabledReason = branchesLoaded
    ? resolveNewWorktreeDisabledReason(branches)
    : null;
  const existingWorktreeDisabledReason = environmentsLoaded
    ? resolveExistingWorktreeDisabledReason(environments.length)
    : null;

  useEffect(() => {
    if (!branchesLoaded || !environmentsLoaded) return;
    const next = snapWorkspaceChoice(value, {
      newWorktreeDisabled: newWorktreeDisabledReason !== null,
      existingWorktreeDisabled: existingWorktreeDisabledReason !== null,
      reuseIds: environments.map((row) => row.id)
    });
    if (workspaceChoiceChanged(value, next)) onChange(next);
  }, [
    branchesLoaded,
    environments,
    environmentsLoaded,
    existingWorktreeDisabledReason,
    newWorktreeDisabledReason,
    onChange,
    value
  ]);

  const selected = value.kind === 'reuse' ? 'reuse' : value.kind;
  const baseBranch = value.kind === 'worktree' ? value.baseBranch : undefined;

  return (
    <div className="environment-picker" data-testid="environment-picker">
      <WorkspaceTriggerIcon kind={value.kind} />
      <PopoverPicklist
        ariaLabel="Workspace"
        value={selected}
        disabled={disabled}
        searchable={false}
        placeholder="Workspace"
        minWidth={280}
        options={[
          {
            value: 'unmanaged',
            label: 'Work locally',
            content: <span className="environment-picker-option"><Laptop size={14} /> Work locally</span>
          },
          {
            value: 'worktree',
            label: 'New worktree',
            description: newWorktreeDisabledReason ?? undefined,
            disabled: newWorktreeDisabledReason !== null,
            content: <span className="environment-picker-option"><GitBranch size={14} /> New worktree</span>
          },
          {
            value: 'reuse',
            label: 'Existing worktree',
            description: existingWorktreeDisabledReason ?? undefined,
            disabled: existingWorktreeDisabledReason !== null,
            content: <span className="environment-picker-option"><GitFork size={14} /> Existing worktree</span>
          },
          ...(allowPersonal ? [{
            value: 'personal',
            label: 'Personal scratch',
            content: <span className="environment-picker-option"><FolderGit2 size={14} /> Personal scratch</span>
          }] : [])
        ]}
        onChange={(next) => {
          if (next === 'unmanaged') onChange({ kind: 'unmanaged' });
          else if (next === 'worktree') onChange({ kind: 'worktree', baseBranch });
          else if (next === 'personal') onChange({ kind: 'personal' });
          else if (next === 'reuse') {
            if (value.kind === 'reuse') return;
            const first = environments[0];
            if (first) onChange({ kind: 'reuse', environmentId: first.id });
          }
        }}
      />
      {value.kind === 'worktree' && branches.length > 0 && (
        <PopoverPicklist
          ariaLabel="Base branch"
          value={baseBranch ?? ''}
          disabled={disabled}
          searchable
          placeholder="Base branch (default)"
          options={branches.map((branch) => ({
            value: branch,
            label: branch,
            content: <span className="environment-picker-option"><GitBranch size={14} /> {branch}</span>
          }))}
          onChange={(next) => onChange({ kind: 'worktree', branchSlug: value.branchSlug, baseBranch: next || undefined })}
        />
      )}
      {value.kind === 'reuse' && environments.length > 0 && (
        <PopoverPicklist
          ariaLabel="Existing worktree"
          value={value.environmentId}
          disabled={disabled}
          searchable={environments.length > 5}
          placeholder="Worktree"
          options={environments.map((row) => ({
            value: row.id,
            label: row.branchName ?? row.name ?? 'Worktree',
            content: (
              <span className="environment-picker-option">
                <GitFork size={14} /> {row.branchName ?? row.name ?? 'Worktree'}
              </span>
            )
          }))}
          onChange={(next) => onChange({ kind: 'reuse', environmentId: next })}
        />
      )}
    </div>
  );
}
