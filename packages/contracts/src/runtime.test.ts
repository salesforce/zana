import { describe, expect, it } from 'vitest';
import {
  RuntimeOutboundSchema,
  SERVER_RUNTIME_PROTOCOL_VERSION,
  ServerRuntimeInboundSchema
} from './runtime.js';

const request = {
  type: 'request',
  protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION,
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
      protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION,
      projectId: 'project-1'
    }).success).toBe(true);
    expect(RuntimeOutboundSchema.safeParse({
      type: 'project-settings-changed',
      protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION,
      projectId: ''
    }).success).toBe(false);
  });

  it('accepts a redacted plugin app snapshot for renderer registration', () => {
    expect(RuntimeOutboundSchema.safeParse({
      type: 'plugin-apps-changed',
      protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION,
      apps: [
        {
          id: 'tasks',
          name: 'Tasks',
          icon: 'ListTodo',
          status: 'running',
          appUrl: '/plugins/tasks/assets/dist/renderer.js?v=1',
          projectTab: { label: 'Tasks', global: false }
        }
      ]
    }).success).toBe(true);
    expect(RuntimeOutboundSchema.safeParse({
      type: 'plugin-apps-changed',
      protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION,
      apps: [{ id: 'tasks', name: 'Tasks', icon: 'ListTodo', status: 'running', appUrl: null, rootDir: '/secret' }]
    }).success).toBe(false);
  });

  it('rejects incompatible utility-process protocol versions before dispatch', () => {
    expect(ServerRuntimeInboundSchema.safeParse({
      ...request,
      protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION + 1,
      operation: 'projects-list'
    }).success).toBe(false);
    expect(RuntimeOutboundSchema.safeParse({
      type: 'stopped',
      protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION + 1
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

  it('accepts plugin rpc and settings operations', () => {
    expect(ServerRuntimeInboundSchema.safeParse({
      ...request,
      operation: 'plugins-call-rpc',
      pluginId: 'notes',
      method: 'ping',
      args: { n: 1 }
    }).success).toBe(true);
    expect(ServerRuntimeInboundSchema.safeParse({
      ...request,
      operation: 'plugins-settings-get',
      pluginId: 'notes'
    }).success).toBe(true);
    expect(ServerRuntimeInboundSchema.safeParse({
      ...request,
      operation: 'plugins-settings-set',
      pluginId: 'notes',
      values: { token: 'secret' }
    }).success).toBe(true);
  });
});
