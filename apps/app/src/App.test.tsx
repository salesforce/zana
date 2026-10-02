import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '@zana-ai/zcc-domain/product';
import { GlobalAgentLauncher } from './components/GlobalAgentLauncher.js';
import { resolveFocusedProject } from './lib/focusedProject.js';

const launcher = vi.hoisted(() => ({ projects: [] as Array<Project | undefined> }));

vi.mock('./components/AgentLauncher.js', () => ({
  AgentLauncher: ({ project }: { project?: Project }) => {
    launcher.projects.push(project);
    return null;
  }
}));

const localProject = { id: 'local', name: 'Local', path: '/work/local' } as Project;
const remoteProject = {
  id: 'remote',
  name: 'Remote',
  path: '/work/remote',
  remote: { host: 'example.internal' }
} as Project;

describe('App launcher project context', () => {
  beforeEach(() => {
    launcher.projects = [];
  });

  it('passes the focused project into the shared launcher host', () => {
    renderToStaticMarkup(
      <GlobalAgentLauncher
        open
        project={remoteProject}
        onClose={() => {}}
        onLaunched={() => {}}
      />
    );

    expect(launcher.projects).toEqual([remoteProject]);
  });

  it('returns exact registered local and remote projects', () => {
    const projects = [localProject, remoteProject];

    expect(resolveFocusedProject(localProject.id, projects)).toBe(localProject);
    expect(resolveFocusedProject(remoteProject.id, projects)).toBe(remoteProject);
  });

  it('leaves scratch/global fallback available without a current registered project', () => {
    expect(resolveFocusedProject(null, [localProject])).toBeUndefined();
    expect(resolveFocusedProject('removed-project', [localProject])).toBeUndefined();

    renderToStaticMarkup(
      <GlobalAgentLauncher open onClose={() => {}} onLaunched={() => {}} />
    );
    expect(launcher.projects).toEqual([undefined]);
  });
});
