import { describe, expect, it } from 'vitest';
import { RuntimeOutboundSchema, ServerRuntimeInboundSchema } from './runtime.js';

const request = {
  type: 'request',
  id: '00000000-0000-4000-8000-000000000001',
  deadlineAt: '2026-08-19T12:00:00.000Z'
};

describe('server runtime contract', () => {
  it('accepts only bounded local project mutations', () => {
    expect(ServerRuntimeInboundSchema.safeParse({
      ...request,
      operation: 'projects-add',
      path: '/workspace/project'
    }).success).toBe(true);
    expect(ServerRuntimeInboundSchema.safeParse({
      ...request,
      operation: 'projects-update',
      projectId: 'project-1',
      patch: { name: 'Renamed', color: '#2f81f7' }
    }).success).toBe(true);
  });

  it('rejects unbounded project payloads before they reach the server store', () => {
    expect(ServerRuntimeInboundSchema.safeParse({
      ...request,
      operation: 'projects-update',
      projectId: 'project-1',
      patch: { favorite: true }
    }).success).toBe(false);
    expect(ServerRuntimeInboundSchema.safeParse({
      ...request,
      operation: 'projects-update',
      projectId: 'project-1',
      patch: { name: 'bad\nname' }
    }).success).toBe(false);
  });

  it('accepts bounded project settings patches only', () => {
    expect(ServerRuntimeInboundSchema.safeParse({
      ...request,
      operation: 'project-settings-set',
      projectId: 'project-1',
      patch: { worktreeIsolation: true }
    }).success).toBe(true);
    expect(ServerRuntimeInboundSchema.safeParse({
      ...request,
      operation: 'project-settings-set',
      projectId: 'project-1',
      patch: { arbitrary: true }
    }).success).toBe(false);
  });

  it('accepts a scoped post-commit project settings invalidation', () => {
    expect(RuntimeOutboundSchema.safeParse({
      type: 'project-settings-changed',
      projectId: 'project-1'
    }).success).toBe(true);
    expect(RuntimeOutboundSchema.safeParse({
      type: 'project-settings-changed',
      projectId: ''
    }).success).toBe(false);
  });

  it('accepts bounded server-owned terminal replay requests', () => {
    expect(ServerRuntimeInboundSchema.safeParse({
      ...request,
      operation: 'terminal-events-since',
      sessionId: '00000000-0000-4000-8000-000000000002',
      afterSequence: -1
    }).success).toBe(true);
    expect(ServerRuntimeInboundSchema.safeParse({
      ...request,
      operation: 'terminal-events-since',
      sessionId: '00000000-0000-4000-8000-000000000002',
      afterSequence: -2
    }).success).toBe(false);
  });
});
