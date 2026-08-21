import type { Project } from '@zana-ai/zcc-domain/product';
import { sortProjectsForDisplay, useUi } from '../../store.js';
import { PopoverPicklist } from '../ui/PopoverPicklist.js';

/**
 * Scope control in the Settings content header: a `Global | Project-Specific`
 * segmented toggle plus, in Project-Specific mode, a single project dropdown.
 * Drives `selectedProjectId` (null = Global) which the Skills/MCP bodies and the
 * Project tab already read. When `allowGlobal` is false (the Project section),
 * only the dropdown shows — there's no global project-settings scope.
 *
 * Switching to Project-Specific with nothing selected defaults to the first
 * project so the body always has a concrete scope to render.
 */
export function ScopeControl({
  projects,
  selectedProjectId,
  allowGlobal
}: {
  projects: Project[];
  selectedProjectId: string | null;
  allowGlobal: boolean;
}) {
  const selectProject = useUi((s) => s.selectProject);
  const sorted = sortProjectsForDisplay(projects);
  const isProjectScope = selectedProjectId !== null;

  const pickProjectScope = () => {
    if (selectedProjectId === null) {
      const first = sorted[0];
      if (first) selectProject(first.id);
    }
  };

  return (
    <div className="settings-scope">
      {allowGlobal && (
        <div className="settings-scope-toggle" role="tablist" aria-label="Scope">
          <button
            type="button"
            role="tab"
            aria-selected={!isProjectScope}
            className={!isProjectScope ? 'active' : ''}
            onClick={() => selectProject(null)}
          >
            Global
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={isProjectScope}
            className={isProjectScope ? 'active' : ''}
            onClick={pickProjectScope}
            disabled={sorted.length === 0}
          >
            Project-Specific
          </button>
        </div>
      )}
      {(isProjectScope || !allowGlobal) && (
        <PopoverPicklist
          className="settings-scope-select"
          value={selectedProjectId ?? ''}
          ariaLabel="Project"
          onChange={(projectId) => selectProject(projectId || null)}
          placeholder="Select a project…"
          searchPlaceholder="Search projects"
          options={[
            ...(!allowGlobal ? [{ value: '', label: 'Select a project…' }] : []),
            ...sorted.map((project) => ({ value: project.id, label: project.name }))
          ]}
        />
      )}
    </div>
  );
}
