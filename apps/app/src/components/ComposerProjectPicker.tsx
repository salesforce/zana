import { useMemo, useState } from 'react';
import { FolderPlus, FolderX } from 'lucide-react';
import type { Project } from '@zana-ai/zcc-domain/product';
import { hasDesktopBridge } from '../lib/app-surface.js';
import { product } from '../lib/product-client.js';
import { useData } from '../store.js';
import { AddLocalProjectDialog } from './AddLocalProjectDialog.js';
import {
  COMPOSER_NEW_PROJECT_LABEL,
  COMPOSER_NO_PROJECT_LABEL,
  composerProjectPickerRows,
  resolveComposerProjectPickerChange
} from './composer-project-picker.js';
import { DEFAULT_COMPOSER_WORKSPACE_LABEL } from './composer-project-default.js';
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
  const [showLocalDialog, setShowLocalDialog] = useState(false);
  const rows = useMemo(() => composerProjectPickerRows(projects), [projects]);

  const selectProject = (projectId: string) => {
    if (projectId === value) return;
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
        title={title}
        minWidth={280}
        emptyHint="No matching projects"
        options={rows.map((row) => ({
          value: row.value,
          label: row.label,
          sticky: row.sticky,
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
