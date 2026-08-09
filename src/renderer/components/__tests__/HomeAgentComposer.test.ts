import { describe, expect, it } from 'vitest';
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
