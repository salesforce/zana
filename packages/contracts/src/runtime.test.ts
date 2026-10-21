import { describe, expect, it } from 'vitest';
import {
  MenubarAgentSchema,
  NATIVE_TOOL_POLICY_EVENT_MAX_BYTES,
  NATIVE_TOOL_POLICY_INPUT_MAX_CHARS,
  nativeToolPolicyInputFits,
  NATIVE_TOOL_POLICY_REASON_MAX_CHARS,
  NativeToolPolicyDecisionSchema,
  PRODUCT_EVENT_ARGS_MAX_CHARS,
  PRODUCT_EVENT_ARGS_MAX_COUNT,
  MenubarThreadsChangedMessageSchema,
  ThreadQueueTurnResultSchema,
  RuntimeOutboundSchema,
  SERVER_RUNTIME_PROTOCOL_VERSION,
  ServerRuntimeInboundSchema,
  SquadMemberRuntimeRequestSchema,
  SquadMemberDeliveryRequestSchema,
  SquadMemberDeliveryResultSchema,
  SquadMemberDeliveryCompletionSchema,
  SquadRuntimeOperationSchema,
  SquadMemberStatusSchema,
  SquadRuntimePreflightResultSchema,
  normalizeNativeToolPolicyReason,
  PluginAppSnapshotSchema
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
  it('accepts only main-attested Modern squad binding context', () => {
    const request = {
      bindingId: '00000000-0000-4000-8000-000000000001', generation: 1, projectId: 'project-1',
      teamId: 'team-1', cohortId: '00000000-0000-4000-8000-000000000002', role: 'worker',
      providerId: 'claude-code', prompt: 'Do work', title: 'Worker', worktreePath: '/tmp/worktree'
    };
    expect(ServerRuntimeInboundSchema.safeParse({ type: 'request', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, id: '00000000-0000-4000-8000-000000000003', deadlineAt: '2026-08-19T12:00:00.000Z', operation: 'squad-member-create', request }).success).toBe(true);
    expect(SquadMemberRuntimeRequestSchema.safeParse({ ...request, role: 'owner' }).success).toBe(false);
    expect(SquadMemberRuntimeRequestSchema.safeParse({ ...request, worktreePath: '' }).success).toBe(false);
  });
  it('requires bounded generation for member status and stop, never generic thread liveness', () => {
    const control = { bindingId: request.id, projectId: 'p', generation: 2 };
    for (const operation of ['squad-member-status', 'squad-member-stop']) {
      expect(ServerRuntimeInboundSchema.safeParse({ ...request, operation, request: control }).success).toBe(true);
      expect(ServerRuntimeInboundSchema.safeParse({ ...request, operation, threadId: request.id, projectId: 'p' }).success).toBe(false);
      for (const generation of [undefined, 0, -1, 1.2]) {
        expect(ServerRuntimeInboundSchema.safeParse({ ...request, operation, request: { ...control, generation } }).success).toBe(false);
      }
    }
    const status = { ...control, live: true, status: 'active', hostOnline: true, providerStarted: true, eventSequence: 3, updatedAt: 1 };
    expect(SquadMemberStatusSchema.safeParse(status).success).toBe(true);
    expect(SquadMemberStatusSchema.safeParse({ ...status, eventSequence: -1 }).success).toBe(false);
  });
  it('requires correlated delivery and distinguishes admission from completion', () => {
    const delivery = { bindingId: request.id, projectId: 'p', generation: 1, assignmentId: 'a', idempotencyKey: 'i', message: 'work' };
    expect(SquadMemberDeliveryRequestSchema.safeParse(delivery).success).toBe(true);
    for (const patch of [{ assignmentId: undefined }, { idempotencyKey: '' }, { message: 'x'.repeat(65537) }]) {
      expect(SquadMemberDeliveryRequestSchema.safeParse({ ...delivery, ...patch }).success).toBe(false);
    }
    const { message: _message, ...correlation } = delivery;
    for (const state of ['accepted', 'completed', 'uncertain', 'rejected']) {
      expect(SquadMemberDeliveryResultSchema.safeParse({ ...correlation, state }).success).toBe(true);
    }
    expect(SquadMemberDeliveryResultSchema.safeParse({ ...correlation, accepted: true }).success).toBe(false);
  });
  it('bounds preflight providers and reports unwired policy explicitly', () => {
    const value = { projectId: 'p', providerIds: ['codex'], nativeToolPolicyRequired: true };
    expect(ServerRuntimeInboundSchema.safeParse({ ...request, operation: 'squad-runtime-preflight', request: value }).success).toBe(true);
    expect(ServerRuntimeInboundSchema.safeParse({ ...request, operation: 'squad-runtime-preflight', request: { ...value, providerIds: Array(33).fill('codex') } }).success).toBe(false);
    expect(SquadRuntimePreflightResultSchema.safeParse({ ready: false, hostId: request.id, policyInventoryReady: true,
      nativeToolPolicyRequired: true, nativeToolPolicyWired: false, reason: 'not wired', providers: [{ providerId: 'codex', available: true }] }).success).toBe(true);
  });
  it('accepts generation-bound completion only through trusted runtime contracts', () => {
    const completion = { bindingId: request.id, projectId: 'p', generation: 1, assignmentId: 'a', idempotencyKey: 'i' };
    const operation = { operation: 'squad-member-delivery-complete', request: completion };
    expect(SquadMemberDeliveryCompletionSchema.safeParse(completion).success).toBe(true);
    expect(SquadRuntimeOperationSchema.safeParse(operation).success).toBe(true);
    expect(ServerRuntimeInboundSchema.safeParse({ ...request, ...operation }).success).toBe(true);
    for (const patch of [{ assignmentId: undefined }, { idempotencyKey: '' }, { generation: 0 }, { message: 'untrusted' }]) {
      expect(SquadMemberDeliveryCompletionSchema.safeParse({ ...completion, ...patch }).success).toBe(false);
      expect(SquadRuntimeOperationSchema.safeParse({ ...operation, request: { ...completion, ...patch } }).success).toBe(false);
    }
  });
  it('accepts bounded coding-agent display grouping without allowing arbitrary manifest data', () => {
    const snapshot = { id: 'custom-agent', name: 'Agent', description: '', icon: 'Terminal', enabled: false,
      provenance: 'direct', status: 'disabled', appUrl: null, collection: 'coding-agents' };
    const message = { type: 'plugin-apps-changed', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, apps: [snapshot] };
    expect(RuntimeOutboundSchema.safeParse(message).success).toBe(true);
    for (const patch of [{ collection: 'unknown' }, { collection: true }, { extra: { source: '/private/path' } }]) {
      expect(RuntimeOutboundSchema.safeParse({ ...message, apps: [{ ...snapshot, ...patch }] }).success).toBe(false);
    }
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

describe('native tool policy deny reasons', () => {
  const normalize = (raw: unknown) => normalizeNativeToolPolicyReason(raw, 'fb');
  // `isWellFormed` is ES2024; a UTF-8 round trip replaces any lone surrogate.
  const wellFormed = (value: string) => Buffer.from(value, 'utf8').toString('utf8') === value;

  it.each([undefined, 12, null, '', '   ', '\n\t ', '\u0085', ' \u0085 ', '\ufeff', '\u0000\u007f\u009f'])(
    'falls back when nothing usable is left of %j',
    (raw) => expect(normalize(raw)).toBe('fb')
  );

  it.each([
    ['a\u0000b\u001bc', 'a b c'],
    ['x\ud83d', 'x\ufffd'],
    ['\ude00y', '\ufffdy'],
    ['ok 😀', 'ok 😀'],
    ['  blocked by plugin policy\n', 'blocked by plugin policy']
  ])('repairs %j into a reason every CLI accepts', (raw, expected) => {
    const reason = normalize(raw);
    expect(reason).toBe(expected);
    expect(wellFormed(reason)).toBe(true);
  });

  it('caps the reason and repairs a surrogate pair the cap split', () => {
    const split = normalize('a'.repeat(NATIVE_TOOL_POLICY_REASON_MAX_CHARS - 1) + '😀');
    expect(split).toHaveLength(NATIVE_TOOL_POLICY_REASON_MAX_CHARS);
    expect(split.endsWith('\ufffd')).toBe(true);
    expect(wellFormed(split)).toBe(true);
    const huge = normalize('z'.repeat(10 * 1024 * 1024));
    expect(huge).toBe('z'.repeat(NATIVE_TOOL_POLICY_REASON_MAX_CHARS));
  });
});

describe('native tool policy runtime contract', () => {
  const call = {
    invocationId: 'a'.repeat(64),
    threadId: '00000000-0000-4000-8000-000000000002',
    projectId: 'project-1',
    profile: 'codex-yolo',
    toolName: 'Bash',
    input: { command: 'pwd' }
  };
  const parse = (patch: Record<string, unknown>, envelope: Record<string, unknown> = {}) =>
    ServerRuntimeInboundSchema.safeParse({ ...request, ...envelope, operation: 'plugins-tool-policy', request: { ...call, ...patch } }).success;
  const empty = '{"content":""}'.length;

  it('accepts a main-asserted tool call, up to the input limit', () => {
    expect(parse({})).toBe(true);
    expect(parse({ input: {} })).toBe(true);
    expect(parse({ input: { content: 'x'.repeat(NATIVE_TOOL_POLICY_INPUT_MAX_CHARS - empty) } })).toBe(true);
  });

  it.each<Record<string, unknown>>([
    { invocationId: 'A'.repeat(64) }, { invocationId: 'a'.repeat(63) },
    { toolName: '' }, { toolName: 'x'.repeat(513) }, { toolName: 'a\nb' },
    { profile: 'Claude' }, { profile: '' }, { profile: 'a b' },
    { threadId: '' }, { threadId: 'x'.repeat(257) }, { projectId: '' }, { projectId: 'x'.repeat(257) },
    { input: ['pwd'] }, { input: 'pwd' }, { input: { content: 'x'.repeat(NATIVE_TOOL_POLICY_INPUT_MAX_CHARS - empty + 1) } },
    { providerId: 'forged' }
  ])('rejects %j', (patch) => expect(parse(patch)).toBe(false));

  it('rejects the previous protocol version', () => {
    expect(parse({}, { protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION - 1 })).toBe(false);
  });

  it('leaves the hook route room for a limit-sized input in any UTF-8', () => {
    expect(nativeToolPolicyInputFits({ content: 'x'.repeat(NATIVE_TOOL_POLICY_INPUT_MAX_CHARS - empty) })).toBe(true);
    expect(nativeToolPolicyInputFits({ content: 'x'.repeat(NATIVE_TOOL_POLICY_INPUT_MAX_CHARS - empty + 1) })).toBe(false);
    expect(nativeToolPolicyInputFits({ count: 1n })).toBe(false);
    expect(NATIVE_TOOL_POLICY_EVENT_MAX_BYTES - 3 * NATIVE_TOOL_POLICY_INPUT_MAX_CHARS).toBeGreaterThanOrEqual(256 * 1024);
  });

  it('rejects input it cannot measure instead of throwing', () => {
    expect(() => parse({ input: { count: 1n } })).not.toThrow();
    expect(parse({ input: { count: 1n } })).toBe(false);
  });

  it('accepts exactly the allow and deny decision shapes', () => {
    for (const value of [{ action: 'allow' }, { action: 'deny', reason: 'x' }, { action: 'deny', reason: 'r'.repeat(NATIVE_TOOL_POLICY_REASON_MAX_CHARS) }]) {
      expect(NativeToolPolicyDecisionSchema.safeParse(value).success).toBe(true);
    }
    for (const value of [
      { action: 'ALLOW' }, { action: 'deny' }, { action: 'deny', reason: '' },
      { action: 'deny', reason: 'r'.repeat(NATIVE_TOOL_POLICY_REASON_MAX_CHARS + 1) },
      { action: 'allow', reason: 'x' }, [], null
    ]) expect(NativeToolPolicyDecisionSchema.safeParse(value).success).toBe(false);
  });
});

describe('PluginAppSnapshotSchema peers flag', () => {
  const base = {
    id: 'sample', name: 'Sample', description: '', icon: 'Puzzle', enabled: true,
    provenance: 'direct', status: 'running', appUrl: null
  };
  it('accepts an optional boolean peers flag', () => {
    expect(PluginAppSnapshotSchema.safeParse(base).success).toBe(true);
    expect(PluginAppSnapshotSchema.safeParse({ ...base, peers: true }).success).toBe(true);
  });
  it('rejects a non-boolean peers flag', () => {
    expect(PluginAppSnapshotSchema.safeParse({ ...base, peers: 'yes' }).success).toBe(false);
  });
});

describe('thread-queue-turn runtime contract', () => {
  const base = {
    type: 'request', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION,
    id: '11111111-1111-4111-8111-111111111111', deadlineAt: '2026-09-25T12:00:00.000Z',
    operation: 'thread-queue-turn', projectId: 'p1'
  };

  it('accepts a bounded text turn and rejects missing or empty fields', () => {
    expect(ServerRuntimeInboundSchema.safeParse({ ...base, threadId: 't1', text: 'hi' }).success).toBe(true);
    expect(ServerRuntimeInboundSchema.safeParse({ ...base, threadId: 't1', text: 'x'.repeat(4096) }).success).toBe(true);
    expect(ServerRuntimeInboundSchema.safeParse({ ...base, text: 'hi' }).success).toBe(false);
    expect(ServerRuntimeInboundSchema.safeParse({ ...base, threadId: 't1', text: '' }).success).toBe(false);
    expect(ServerRuntimeInboundSchema.safeParse({ ...base, threadId: 't1', text: 'x'.repeat(4097) }).success).toBe(false);
  });

  it('validates the result shape strictly', () => {
    expect(ThreadQueueTurnResultSchema.safeParse({ ok: true, queued: true }).success).toBe(true);
    expect(ThreadQueueTurnResultSchema.safeParse({ ok: false, reason: 'not-live' }).success).toBe(true);
    expect(ThreadQueueTurnResultSchema.safeParse({ ok: 'yes' }).success).toBe(false);
    expect(ThreadQueueTurnResultSchema.safeParse({ ok: true, extra: 1 }).success).toBe(false);
  });
});
