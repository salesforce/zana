import { useMemo, useState } from 'react';
import { FolderPlus, FolderX, Network } from 'lucide-react';
import type { Project } from '@zana-ai/zcc-domain/product';
import { hasDesktopBridge } from '../lib/app-surface.js';
import { product } from '../lib/product-client.js';
import { useData } from '../store.js';
import { AddLocalProjectDialog } from './AddLocalProjectDialog.js';
import {
  COMPOSER_NEW_PROJECT_LABEL,
  COMPOSER_NO_PROJECT_LABEL,
  composerProjectPickerRows,
  composerProjectRemoteDescription,
  resolveComposerProjectPickerChange
} from './composer-project-picker.js';
import { DEFAULT_COMPOSER_WORKSPACE_LABEL, isRemoteWorkspaceProject } from './composer-project-default.js';
import { PopoverPicklist } from './ui/PopoverPicklist.js';

export function ComposerProjectPicker({
  projects,
  value,
  onChange,
  disabled,
  title
}: {
  projects: readonly Project[];
  value: string;
  onChange: (projectId: string) => void;
  disabled?: boolean;
  title?: string;
}) {
  const addProject = useData((s) => s.addProject);
  const addProjectByPath = useData((s) => s.addProjectByPath);
  const rememberLastProjectId = useData((s) => s.rememberLastProjectId);
  const [showLocalDialog, setShowLocalDialog] = useState(false);
  const rows = useMemo(() => composerProjectPickerRows(projects), [projects]);
  const selectedProject = projects.find((project) => project.id === value);
  const selectedRemoteHint = composerProjectRemoteDescription(selectedProject);

  const selectProject = (projectId: string) => {
    if (projectId === value) return;
    if (projectId) rememberLastProjectId(projectId);
    onChange(projectId);
  };

  const pickNewProject = async () => {
    if (hasDesktopBridge()) {
      const project = await addProject();
      if (project) selectProject(project.id);
      return;
    }
    setShowLocalDialog(true);
  };

  return (
    <>
      <PopoverPicklist
        value={value}
        ariaLabel="Project"
        placeholder={DEFAULT_COMPOSER_WORKSPACE_LABEL}
        disabled={disabled}
        title={title ?? selectedRemoteHint}
        triggerIcon={isRemoteWorkspaceProject(selectedProject)
          ? <Network size={14} strokeWidth={2} className="project-remote-icon" aria-hidden="true" />
          : undefined}
        minWidth={280}
        emptyHint="No matching projects"
        options={rows.map((row) => ({
          value: row.value,
          label: row.label,
          sticky: row.sticky,
          description: row.description,
          content: row.action === 'new-project'
            ? (
              <span className="composer-project-picker-option">
                <FolderPlus size={14} aria-hidden="true" />
                {COMPOSER_NEW_PROJECT_LABEL}
              </span>
            )
            : row.action === 'no-project'
              ? (
                <span className="composer-project-picker-option">
                  <FolderX size={14} aria-hidden="true" />
                  {COMPOSER_NO_PROJECT_LABEL}
                </span>
              )
              : row.remote
                ? (
                  <span className="composer-project-picker-option">
                    <Network size={14} strokeWidth={2} className="project-remote-icon" aria-hidden="true" />
                    {row.label}
                  </span>
                )
                : undefined
        }))}
        onChange={(next) => {
          const resolved = resolveComposerProjectPickerChange(next, projects);
          if (resolved.type === 'new-project') {
            void pickNewProject();
            return;
          }
          selectProject(resolved.projectId);
        }}
      />
      {showLocalDialog && (
        <AddLocalProjectDialog
          onClose={() => setShowLocalDialog(false)}
          onBrowse={() => product.projects.pickDirectory()}
          onSubmit={async (path, hostId) => {
            const project = await addProjectByPath(path, hostId ? { hostId } : undefined);
            if (project) selectProject(project.id);
            return project;
          }}
        />
      )}
    </>
  );
}
