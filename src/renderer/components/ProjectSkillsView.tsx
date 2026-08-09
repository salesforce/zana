import type { Project } from '@shared/types';
import { SkillsBody } from './SkillsPanel';

/**
 * The per-project Skills tab, mounted in a project's workspace (sibling to the
 * Goals / Follow-ups / Feed tabs). A thin wrapper over {@link SkillsBody} in its
 * project-scoped shape: it locks the panel to THIS project so the project-scope
 * skills (`.claude/skills`, `.cursor/rules`, …) resolve against it regardless of
 * the globally selected project. The Settings → Skills tab mounts the same
 * component with no `projectId` for the follow-the-selection behaviour.
 */
export function ProjectSkillsView({ project }: { project: Project }) {
  return (
    <div className="project-skills-view">
      <SkillsBody projectId={project.id} />
    </div>
  );
}
