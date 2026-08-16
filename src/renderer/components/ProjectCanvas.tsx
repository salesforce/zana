import { lazy, Suspense, useState } from 'react';
import { Bot, LayoutDashboard, PanelRightOpen, Plus, X } from 'lucide-react';
import type { Project } from '@shared/types';
import { useData, useUi, type ProjectCanvasBlock, type ProjectView } from '../store';
import { useProjectTabModules } from '../modules';
import { ProjectAgentsBoard } from './ProjectAgentsBoard';
import { ProjectExtensionTab } from './ProjectExtensionTab';
import { AgentLauncher } from './AgentLauncher';
import { PopoverPicklist, type PopoverPicklistOption } from './ui/PopoverPicklist';

const LibraryView = lazy(() => import('./LibraryView').then((m) => ({ default: m.LibraryView })));

const TEMPLATES = [
  { value: 'single', label: 'One block' },
  { value: 'columns-2', label: 'Two columns' },
  { value: 'rows-2', label: 'Two rows' },
  { value: 'grid-2x2', label: 'Four blocks' }
] as const;

function newBlock(projectId: string, view: ProjectView = 'agents'): ProjectCanvasBlock {
  return { id: `canvas-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, projectId, view };
}

export function ProjectCanvas() {
  const projects = useData((s) => s.projects);
  const canvas = useUi((s) => s.projectCanvas);
  const setCanvas = useUi((s) => s.setProjectCanvas);
  const selectProject = useUi((s) => s.selectProject);
  const enterProjectFocus = useUi((s) => s.enterProjectFocus);
  const modules = useProjectTabModules();
  const [launcherProject, setLauncherProject] = useState<Project | null>(null);
  const defaultProject = projects[0];
  const active = canvas ?? (defaultProject ? { template: 'columns-2' as const, blocks: [newBlock(defaultProject.id)] } : null);

  if (!active) {
    return <main className="project-canvas project-canvas-empty"><LayoutDashboard size={28} /><h2>Project canvas</h2><p>Add a project first, then arrange work from multiple projects here.</p></main>;
  }

  const update = (blocks: ProjectCanvasBlock[], template = active.template) =>
    setCanvas({ template, blocks: blocks.slice(0, 4) });
  const changeBlock = (id: string, patch: Partial<ProjectCanvasBlock>) =>
    update(active.blocks.map((block) => block.id === id ? { ...block, ...patch } : block));
  const add = () => {
    const projectId = projects.find((project) => !active.blocks.some((block) => block.projectId === project.id))?.id ?? projects[0]?.id;
    if (projectId && active.blocks.length < 4) update([...active.blocks, newBlock(projectId)]);
  };

  return (
    <main className="project-canvas">
      <header className="project-canvas-header">
        <div><LayoutDashboard size={17} /><span>Project canvas</span><small>Work across projects in one window</small></div>
        <div className="project-canvas-actions">
          <PopoverPicklist
            ariaLabel="Canvas layout"
            value={active.template}
            options={TEMPLATES}
            searchable={false}
            minWidth={160}
            triggerClassName="project-canvas-picker"
            onChange={(template) => update(active.blocks, template)}
          />
          <button type="button" onClick={add} disabled={active.blocks.length >= 4} title="Add project block"><Plus size={15} /> Add block</button>
        </div>
      </header>
      <div className={`project-canvas-grid canvas-${active.template}`}>
        {active.blocks.map((block) => {
          const project = projects.find((candidate) => candidate.id === block.projectId);
          return <CanvasBlock key={block.id} block={block} project={project} projects={projects} modules={modules} onChange={changeBlock} onRemove={() => update(active.blocks.filter((candidate) => candidate.id !== block.id))} onFocus={() => project && enterProjectFocus(project.id)} onSelect={() => project && selectProject(project.id)} onNewAgent={() => project && setLauncherProject(project)} />;
        })}
      </div>
      {launcherProject && <AgentLauncher project={launcherProject} backgroundTabs={[]} onClose={() => setLauncherProject(null)} />}
    </main>
  );
}

function CanvasBlock({ block, project, projects, modules, onChange, onRemove, onFocus, onSelect, onNewAgent }: {
  block: ProjectCanvasBlock; project?: Project; projects: Project[]; modules: ReturnType<typeof useProjectTabModules>;
  onChange: (id: string, patch: Partial<ProjectCanvasBlock>) => void; onRemove: () => void; onFocus: () => void; onSelect: () => void; onNewAgent: () => void;
}) {
  const viewOptions: PopoverPicklistOption<string>[] = [
    { value: 'agents', label: 'Agents' }, { value: 'explorer', label: 'Explorer' }, { value: 'library', label: 'Library' },
    ...modules.map((module) => ({ value: module.id, label: module.projectTab?.label ?? module.title, group: 'Extensions' }))
  ];
  const projectOptions = projects.map((candidate) => ({ value: candidate.id, label: candidate.name }));
  const module = modules.find((candidate) => candidate.id === block.view);
  return <section className="project-canvas-block" aria-label={`${project?.name ?? 'Unavailable project'} ${block.view} block`} onFocus={onSelect}>
    <header className="project-canvas-block-header">
      <PopoverPicklist ariaLabel="Project for this canvas block" value={project?.id ?? ''} options={projectOptions} searchable={false} minWidth={180} triggerClassName="project-canvas-block-picker" onChange={(projectId) => onChange(block.id, { projectId })} />
      <PopoverPicklist ariaLabel="View for this canvas block" value={String(block.view)} options={viewOptions} searchable={false} minWidth={160} triggerClassName="project-canvas-block-picker" onChange={(view) => onChange(block.id, { view })} />
      <span className="grow" />
      <button type="button" className="project-canvas-icon" onClick={onFocus} title="Focus this project"><PanelRightOpen size={14} /></button>
      <button type="button" className="project-canvas-icon" onClick={onRemove} title="Remove block"><X size={14} /></button>
    </header>
    <div className="project-canvas-block-content">
      {!project ? <div className="project-canvas-empty-block">This project is no longer available.</div>
        : block.view === 'agents' ? <ProjectAgentsBoard project={project} onNewAgent={onNewAgent} embedded />
        : block.view === 'explorer' ? <div className="project-canvas-empty-block"><Bot size={18} /> Explorer is available when you focus this project.</div>
        : block.view === 'library' ? <Suspense fallback={<div className="workbench-status">Loading library...</div>}><LibraryView project={project} /></Suspense>
        : module ? <div className="project-ext-tab"><ProjectExtensionTab moduleId={module.id} project={project} /></div>
        : <div className="project-canvas-empty-block"><Bot size={18} /> This view is not available in the canvas yet.</div>}
    </div>
  </section>;
}
