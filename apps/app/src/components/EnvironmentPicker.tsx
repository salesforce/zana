import { useEffect, useState } from 'react';
import { GitBranch, GitFork, FolderGit2 } from 'lucide-react';
import type { Environment, SpawnEnvironmentChoice } from '@zana-ai/zcc-domain';
import { product } from '../lib/product-client.js';
import { PopoverPicklist } from './ui/PopoverPicklist.js';

export type WorkspacePickerValue = SpawnEnvironmentChoice;

export function workspaceToSpawnChoice(value: WorkspacePickerValue): SpawnEnvironmentChoice {
  return value;
}

export function defaultWorkspaceChoice(isolateByDefault: boolean): WorkspacePickerValue {
  return isolateByDefault ? { kind: 'worktree' } : { kind: 'unmanaged' };
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

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    void product.environments.list(projectId).then((rows) => {
      if (!cancelled) setEnvironments(rows.filter((row) => row.status === 'ready' && row.workspaceProvisionType === 'managed-worktree'));
    }).catch(() => {
      if (!cancelled) setEnvironments([]);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const selected = value.kind === 'reuse'
    ? `reuse:${value.environmentId}`
    : value.kind;

  return (
    <div className="environment-picker" data-testid="environment-picker">
      <GitFork size={14} aria-hidden="true" />
      <PopoverPicklist
        ariaLabel="Workspace"
        value={selected}
        disabled={disabled}
        searchable={false}
        placeholder="Workspace"
        options={[
          {
            value: 'unmanaged',
            label: 'This checkout',
            content: <span className="environment-picker-option"><FolderGit2 size={14} /> This checkout</span>
          },
          {
            value: 'worktree',
            label: 'New worktree',
            content: <span className="environment-picker-option"><GitBranch size={14} /> New worktree</span>
          },
          ...environments.map((row) => ({
            value: `reuse:${row.id}`,
            label: row.branchName ?? row.name ?? 'Worktree',
            content: (
              <span className="environment-picker-option">
                <GitFork size={14} /> {row.branchName ?? row.name ?? 'Worktree'}
              </span>
            )
          })),
          ...(allowPersonal ? [{
            value: 'personal',
            label: 'Personal scratch',
            content: <span className="environment-picker-option"><FolderGit2 size={14} /> Personal scratch</span>
          }] : [])
        ]}
        onChange={(next) => {
          if (next === 'unmanaged') onChange({ kind: 'unmanaged' });
          else if (next === 'worktree') onChange({ kind: 'worktree' });
          else if (next === 'personal') onChange({ kind: 'personal' });
          else if (next.startsWith('reuse:')) onChange({ kind: 'reuse', environmentId: next.slice('reuse:'.length) });
        }}
      />
    </div>
  );
}
