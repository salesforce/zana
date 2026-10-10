import { describe, expect, it } from 'vitest';
import {
  MenubarAgentSchema,
  PRODUCT_EVENT_ARGS_MAX_CHARS,
  PRODUCT_EVENT_ARGS_MAX_COUNT,
  MenubarThreadsChangedMessageSchema,
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
  it('keeps feed access project-scoped and bounded without exposing file paths or host selection', () => {
    const parse = (value: unknown) => ServerRuntimeInboundSchema.safeParse({ ...request, operation: 'project-feed', request: value }).success;
    const event = { projectId: 'p', kind: 'commit', ts: 1, title: 'Commit', dedupeKey: 'hash' };
    expect(parse({ action: 'list', projectId: 'p' })).toBe(true);
    expect(parse({ action: 'append', projectId: 'p', events: [event] })).toBe(true);
    for (const value of [
      { action: 'list', projectId: 'p', hostId: 'other' }, { action: 'list', projectId: 'p', path: '/private' },
      { action: 'remove', projectId: 'p' }, { action: 'append', projectId: 'p', events: Array(101).fill(event) },
      { action: 'append', projectId: 'p', events: [{ ...event, id: 'forged' }] },
    ]) expect(parse(value)).toBe(false);
  });
  it('accepts only a bounded project identity for history reads', () => {
    const parse = (value: unknown) => ServerRuntimeInboundSchema.safeParse({ ...request, operation: 'project-history', request: value }).success;
    expect(parse({ projectId: 'p', limit: 50 })).toBe(true);
    for (const value of [{ projectId: 'p', limit: 101 }, { projectId: 'p', limit: 50, hostId: 'other' }, { projectId: 'p', limit: 50, path: '/private' }]) expect(parse(value)).toBe(false);
  });
  it('allows only a registered project identity for read-only catalogue requests', () => {
    const parse = (value: unknown) => ServerRuntimeInboundSchema.safeParse({ ...request, operation: 'project-catalogs', request: value }).success;
    expect(parse({ projectId: 'p' })).toBe(true);
    for (const value of [{ projectId: '' }, { projectId: 'p', hostId: 'other' }, { projectId: 'p', path: '/private' }, { projectId: 'p', action: 'write' }]) expect(parse(value)).toBe(false);
  });
  it('accepts empty watcher/reset invalidations but refuses snapshots and unregistered event channels', () => {
    const parse = (channel: string, args: unknown[]) => ServerRuntimeInboundSchema.safeParse({ ...request, operation: 'product-event', channel, args }).success;
    for (const channel of ['library:changed', 'product:reset']) {
      expect(parse(channel, [])).toBe(true);
      expect(parse(channel, [{ forged: 'snapshot' }])).toBe(false);
    }
    expect(parse('config:onChanged', [{ theme: 'light' }])).toBe(true);
    expect(parse('arbitrary:native-operation', [])).toBe(false);
  });
  it('accepts product-event args at exactly the cap and rejects one more character or argument', () => {
    const parse = (args: unknown[]) => ServerRuntimeInboundSchema.safeParse({ ...request, operation: 'product-event', channel: 'config:onChanged', args }).success;
    const sized = (chars: number) => ['x'.repeat(chars - 4)]; // JSON of [""] adds 4 characters
    expect(JSON.stringify(sized(PRODUCT_EVENT_ARGS_MAX_CHARS)).length).toBe(PRODUCT_EVENT_ARGS_MAX_CHARS);
    expect(parse(sized(PRODUCT_EVENT_ARGS_MAX_CHARS))).toBe(true);
    expect(parse(sized(PRODUCT_EVENT_ARGS_MAX_CHARS + 1))).toBe(false);
    expect(parse(Array(PRODUCT_EVENT_ARGS_MAX_COUNT).fill(1))).toBe(true);
    expect(parse(Array(PRODUCT_EVENT_ARGS_MAX_COUNT + 1).fill(1))).toBe(false);
  });
  it.each(['library-changed', 'projects-changed'])('accepts only the bounded runtime %s invalidation shape', type => {
    const event = { type, protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION };
    expect(RuntimeOutboundSchema.safeParse(event).success).toBe(true);
    for (const patch of [{ protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION - 1 }, { rootPath: '/' }, { docs: [] }]) expect(RuntimeOutboundSchema.safeParse({ ...event, ...patch }).success).toBe(false);
  });
  it('confines desktop library commands to validated scope and read revisions', () => {
    const value = { action: 'write', scope: 'project', projectId: 'p', relPath: 'note.md', content: 'text', expectedSha256: 'a'.repeat(64) };
    const parse = (patch: Record<string, unknown>) => ServerRuntimeInboundSchema.safeParse({ ...request, operation: 'library-document', request: { ...value, ...patch } }).success;
    expect(parse({})).toBe(true);
    for (const patch of [{ hostId: 'foreign' }, { relPath: '../outside' }, { expectedSha256: undefined }, { scope: 'global' }, { root: '/' }]) expect(parse(patch)).toBe(false);
  });
  it('accepts metadata revisions but never renderer-selected paths or hosts', () => {
    const value = { projectId: 'project-1', kind: 'followups', action: 'write', id: 'record-1', content: '{}', expectedSha256: null };
    const parse = (patch: Record<string, unknown>) => ServerRuntimeInboundSchema.safeParse({ ...request, operation: 'project-metadata', request: { ...value, ...patch } }).success;
    expect(parse({})).toBe(true);
    expect(parse({ expectedSha256: 'a'.repeat(64) })).toBe(true);
    for (const patch of [{ hostId: 'other' }, { path: '/etc/passwd' }, { id: '../escape' }, { content: 'x'.repeat(1024 * 1024 + 1) }, { expectedSha256: 'bad' }, { kind: 'arbitrary' }]) expect(parse(patch)).toBe(false);
    expect(ServerRuntimeInboundSchema.safeParse({ ...request, operation: 'project-metadata', request: { projectId: 'project-1', kind: 'goals', action: 'remove', id: 'goal', expectedSha256: null } }).success).toBe(false);
  });

  it('validates project icon changes at the runtime boundary', () => {
    for (const [icon, expected] of [['Cloud', true], ['Circle', true], ['unknown', false], [null, false], [4, false]] as const) {
      expect(ServerRuntimeInboundSchema.safeParse({ ...request, operation: 'projects-update', projectId: 'p1', patch: { icon } }).success).toBe(expected);
    }
  });
  it('accepts only bounded local project mutations', () => {
    expect(ServerRuntimeInboundSchema.safeParse({ ...request, operation: 'projects-add', path: '/workspace/project' }).success).toBe(true);
    expect(ServerRuntimeInboundSchema.safeParse({ ...request, operation: 'projects-update', projectId: 'project-1', patch: { name: 'Renamed', color: '#2f81f7' } }).success).toBe(true);
  });
  it('rejects unbounded project payloads before they reach the server store', () => {
    expect(ServerRuntimeInboundSchema.safeParse({ ...request, operation: 'projects-update', projectId: 'project-1', patch: { favorite: true } }).success).toBe(false);
    expect(ServerRuntimeInboundSchema.safeParse({ ...request, operation: 'projects-update', projectId: 'project-1', patch: { name: 'bad\nname' } }).success).toBe(false);
  });
  it('accepts bounded project settings patches only', () => {
    expect(ServerRuntimeInboundSchema.safeParse({ ...request, operation: 'project-settings-set', projectId: 'project-1', patch: { worktreeIsolation: true } }).success).toBe(true);
    expect(ServerRuntimeInboundSchema.safeParse({ ...request, operation: 'project-settings-set', projectId: 'project-1', patch: { arbitrary: true } }).success).toBe(false);
  });
  it('accepts a scoped post-commit project settings invalidation', () => {
    expect(RuntimeOutboundSchema.safeParse({ type: 'project-settings-changed', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, projectId: 'project-1' }).success).toBe(true);
    expect(RuntimeOutboundSchema.safeParse({ type: 'project-settings-changed', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, projectId: '' }).success).toBe(false);
  });
  it('accepts a redacted plugin app snapshot for renderer registration', () => {
    expect(RuntimeOutboundSchema.safeParse({ type: 'plugin-apps-changed', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, apps: [{ id: 'tasks', name: 'Tasks', description: 'Track work items', icon: 'ListTodo', enabled: true, provenance: 'builtin', status: 'running', appUrl: '/plugins/tasks/assets/dist/renderer.js?v=1', projectTab: { label: 'Tasks', global: false } }] }).success).toBe(true);
    expect(RuntimeOutboundSchema.safeParse({ type: 'plugin-apps-changed', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, apps: [{ id: 'tasks', name: 'Tasks', description: 'Track work items', icon: 'ListTodo', enabled: true, provenance: 'builtin', status: 'running', appUrl: null, rootDir: '/secret' }] }).success).toBe(false);
  });
  it('rejects incompatible utility-process protocol versions before dispatch', () => {
    expect(ServerRuntimeInboundSchema.safeParse({ ...request, protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION + 1, operation: 'projects-list' }).success).toBe(false);
    expect(RuntimeOutboundSchema.safeParse({ type: 'stopped', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION + 1 }).success).toBe(false);
  });
  it('accepts local plugin classification without allowing installation paths across IPC', () => {
    const snapshot = { id: 'local-panel', name: 'Local panel', description: '', icon: 'Cloud', enabled: true, provenance: 'direct', sourceKind: 'path', status: 'running', appUrl: '/plugins/local-panel/assets/app.js' };
    const message = { type: 'plugin-apps-changed', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, apps: [snapshot] };
    expect(RuntimeOutboundSchema.safeParse(message).success).toBe(true);
    for (const sourceKind of ['git', 'npm', 'builtin']) {
      expect(RuntimeOutboundSchema.safeParse({ ...message, apps: [{ ...snapshot, sourceKind }] }).success).toBe(true);
    }
    for (const extra of [{ sourceKind: 'unknown' }, { source: 'path:/private/plugin' }, { rootDir: '/private/plugin' }]) {
      expect(RuntimeOutboundSchema.safeParse({ ...message, apps: [{ ...snapshot, ...extra }] }).success).toBe(false);
    }
  });
  it('accepts bounded server-owned terminal replay requests', () => {
    expect(ServerRuntimeInboundSchema.safeParse({ ...request, operation: 'terminal-events-since', sessionId: '00000000-0000-4000-8000-000000000002', afterSequence: -1 }).success).toBe(true);
    expect(ServerRuntimeInboundSchema.safeParse({ ...request, operation: 'terminal-events-since', sessionId: '00000000-0000-4000-8000-000000000002', afterSequence: -2 }).success).toBe(false);
  });
  it('accepts plugin rpc and settings operations', () => {
    expect(ServerRuntimeInboundSchema.safeParse({ ...request, operation: 'plugins-call-rpc', pluginId: 'notes', method: 'ping', args: { n: 1 } }).success).toBe(true);
    expect(ServerRuntimeInboundSchema.safeParse({ ...request, operation: 'plugins-settings-get', pluginId: 'notes' }).success).toBe(true);
    expect(ServerRuntimeInboundSchema.safeParse({ ...request, operation: 'plugins-settings-set', pluginId: 'notes', values: { token: 'secret' } }).success).toBe(true);
  });
});

describe('menubar runtime contracts', () => {
  it('accepts bounded list and open requests', () => {
    const base = {
      type: 'request', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION,
      id: '11111111-1111-4111-8111-111111111111', deadlineAt: '2026-09-25T12:00:00.000Z'
    };
    expect(ServerRuntimeInboundSchema.safeParse({ ...base, operation: 'menubar-threads-list', limit: 100 }).success).toBe(true);
    expect(ServerRuntimeInboundSchema.safeParse({ ...base, operation: 'menubar-threads-list', limit: 101 }).success).toBe(false);
    expect(ServerRuntimeInboundSchema.safeParse({ ...base, operation: 'menubar-thread-open', threadId: 't1', projectId: 'p1' }).success).toBe(true);
  });

  it('requires kind-specific row identity', () => {
    const base = {
      agentId: 't1', projectId: 'p1', rowKey: 'thread:t1', projectName: 'Project', title: 'Thread',
      state: 'working', favorite: false, canFavorite: false, canReply: false, createdAt: 1
    };
    expect(MenubarAgentSchema.safeParse({
      ...base, kind: 'thread', threadId: 't1', status: 'active', hasPendingInteraction: false
    }).success).toBe(true);
    expect(MenubarAgentSchema.safeParse({ ...base, kind: 'thread', sessionId: 't1' }).success).toBe(false);
  });

  it('accepts changed hints', () => {
    expect(MenubarThreadsChangedMessageSchema.safeParse({
      type: 'menubar-threads-changed', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION
    }).success).toBe(true);
  });
});
