import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Project } from '@zana-ai/zcc-domain/product';
import { resolveFocusedProject } from './lib/focusedProject.js';

const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');

const localProject = { id: 'local', name: 'Local', path: '/work/local' } as Project;
const remoteProject = {
  id: 'remote',
  name: 'Remote',
  path: '/work/remote',
  remote: { host: 'example.internal' }
} as Project;

describe('App launcher project context', () => {
  it('passes the focused project into the shared launcher host', () => {
    expect(app).toContain('<AgentLauncher\n          project={focusedProject}');
  });

  it('returns exact registered local and remote projects', () => {
    const projects = [localProject, remoteProject];

    expect(resolveFocusedProject(localProject.id, projects)).toBe(localProject);
    expect(resolveFocusedProject(remoteProject.id, projects)).toBe(remoteProject);
  });

  it('leaves scratch/global fallback available without a current registered project', () => {
    expect(resolveFocusedProject(null, [localProject])).toBeUndefined();
    expect(resolveFocusedProject('removed-project', [localProject])).toBeUndefined();
  });
});
