import { useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { PROJECT_COLORS } from '@zana-ai/zcc-domain/project-colors';
import type { PluginSdkApp } from '@zana-ai/zcc-plugin-sdk/app';
import { useData } from '../store.js';
import { isScratchWorkspaceProject } from '../components/composer-project-default.js';
import { ProjectIconPicker } from '../components/listpane/ProjectIconPicker.js';

interface AppearanceMenuState {
  target: { projectId: string; x: number; y: number } | null;
  open(projectId: string, at: { x: number; y: number }): void;
  close(): void;
}

export const useProjectAppearanceMenuStore = create<AppearanceMenuState>((set) => ({
  target: null,
  open: (projectId, at) => {
    if (typeof projectId !== 'string' || !at || !Number.isFinite(at.x) || !Number.isFinite(at.y)) return;
    // The renderer is untrusted for authorization, but an unknown id has nothing to edit.
    if (!useData.getState().projects.some((project) => project.id === projectId)) return;
    set({ target: { projectId, x: at.x, y: at.y } });
  },
  close: () => set({ target: null })
}));

const actions = {
  open: (projectId: string, at: { x: number; y: number }) => useProjectAppearanceMenuStore.getState().open(projectId, at)
};

/** `experimental_useProjectAppearanceMenu()`: opens the host's Icon + Color editor. Never writes project data itself. */
export const useProjectAppearanceMenu: PluginSdkApp['experimental_useProjectAppearanceMenu'] = () => actions;

/** Mounted once at app level. */
export function ProjectAppearanceMenuHost() {
  const target = useProjectAppearanceMenuStore((s) => s.target);
  const close = useProjectAppearanceMenuStore((s) => s.close);
  const project = useData((s) => (target ? s.projects.find((entry) => entry.id === target.projectId) : undefined));
  const updateProject = useData((s) => s.updateProject);
  const ref = useRef<HTMLDivElement>(null);
  const visible = Boolean(target && project);

  useEffect(() => {
    if (target && !project) close();
  }, [target, project, close]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !target) return;
    const previous = document.activeElement;
    const rect = el.getBoundingClientRect();
    el.style.left = `${Math.max(8, Math.min(target.x, window.innerWidth - rect.width - 8))}px`;
    el.style.top = `${Math.max(8, Math.min(target.y, window.innerHeight - rect.height - 8))}px`;
    el.querySelector('button')?.focus();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, [target, visible]);

  useEffect(() => {
    if (!visible) return;
    const dismiss = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close(); }
    };
    window.addEventListener('mousedown', dismiss);
    window.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('mousedown', dismiss);
      window.removeEventListener('keydown', escape);
    };
  }, [visible, close]);

  if (!target || !project) return null;
  const apply = (patch: { icon: NonNullable<typeof project.icon> } | { color: string | undefined }) => {
    void updateProject(project.id, patch);
    close();
  };
  return createPortal(
    <div ref={ref} className="project-menu" role="group" aria-label={`Appearance for ${project.name}`}
      style={{ left: target.x, top: target.y }} onClick={(event) => event.stopPropagation()}>
      {!isScratchWorkspaceProject(project) && <>
        <div className="project-menu-label">Icon</div>
        <ProjectIconPicker value={project.icon} onChange={(icon) => apply({ icon })} />
      </>}
      <div className="project-menu-label">Color</div>
      <div className="project-menu-swatches">
        {PROJECT_COLORS.map((color) => (
          <button key={color} type="button" className="project-swatch" style={{ background: color }}
            aria-label={`Set color ${color}`} onClick={() => apply({ color })} />
        ))}
        <button type="button" className="project-swatch reset" aria-label="Reset color" onClick={() => apply({ color: undefined })}>×</button>
      </div>
    </div>, document.body
  );
}
