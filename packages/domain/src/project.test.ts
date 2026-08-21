import { describe, expect, it } from 'vitest';
import { toProjectSummary, type Project } from './project.js';

describe('toProjectSummary', () => {
  it('projects identity fields and omits local-only metadata', () => {
    const project: Project = {
      id: 'p1',
      name: 'Demo',
      path: '/tmp/demo',
      createdAt: 1,
      lastActiveAt: 2,
      sortIndex: 9,
      tag: 'demo',
      quickAgent: true,
      remote: { host: 'devbox' }
    };
    expect(toProjectSummary(project)).toEqual({
      id: 'p1',
      name: 'Demo',
      path: '/tmp/demo',
      tag: 'demo',
      remote: { host: 'devbox' },
      quickAgent: true
    });
  });
});
