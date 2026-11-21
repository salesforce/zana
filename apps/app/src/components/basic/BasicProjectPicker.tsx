import { Folder } from 'lucide-react';
import type { Project } from '@zana-ai/zcc-domain/product';
import { PopoverPicklist } from '../ui/PopoverPicklist.js';
import { composerProjectLabel } from '../composer-project-default.js';
import './basic-project-picker.css';

/** A project keeps its registered target; Basic never projects it onto another machine. */
export function BasicProjectPicker({ projects, value, pinned, onChange }: {
  projects: readonly Project[];
  value: string;
  pinned?: Project;
  onChange: (project: Project) => void;
}) {
  const selected = pinned ?? projects.find(project => project.id === value);
  return <div className="basic-composer-project" data-testid="basic-composer-project">
    <Folder size={14} aria-hidden="true" />
    {pinned ? <span aria-label="Project">Project: {composerProjectLabel(pinned)}</span> : <PopoverPicklist
      ariaLabel="Project"
      value={value}
      placeholder={selected ? composerProjectLabel(selected) : 'Choose a project'}
      searchable={projects.length > 5}
      searchPlaceholder="Search projects…"
      options={projects.map(project => ({
        value: project.id,
        label: composerProjectLabel(project),
        ...(project.remote ? { description: 'Remote project' } : {})
      }))}
      onChange={id => {
        const project = projects.find(row => row.id === id);
        if (project) onChange(project);
      }}
    />}
  </div>;
}
