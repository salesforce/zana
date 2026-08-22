import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseHomeLauncherPreferences } from '../HomeAgentComposer.js';

describe('HomeAgentComposer preferences', () => {
  it('ignores legacy harness selection so configured defaults win on opening', () => {
    expect(parseHomeLauncherPreferences(JSON.stringify({
      projectId: 'p1',
      familyId: 'opencode',
      modelId: 'gpt-5'
    }))).toEqual({ projectId: 'p1', modelId: 'gpt-5' });
  });

  it('drops malformed stored values', () => {
    expect(parseHomeLauncherPreferences('{')).toEqual({});
    expect(parseHomeLauncherPreferences(JSON.stringify({ projectId: 3, modelId: false }))).toEqual({});
  });
});

describe('HomeAgentComposer pinning', () => {
  it('locks to a passed project and skips the scratch default', () => {
    const source = readFileSync(new URL('../HomeAgentComposer.tsx', import.meta.url), 'utf8');
    expect(source).toContain('{ project: pinnedProject }');
    expect(source).toContain('if (pinnedProject) return;');
    expect(source).toContain('{!pinnedProject && (');
    expect(source).toContain('setProjectId(pinnedProject.id)');
  });
});
