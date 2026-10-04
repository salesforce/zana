import { z } from 'zod';
import type { ZccPluginApi } from '@zana-ai/zcc-plugin-sdk/server';
import type { DispatchAdmissionDecision, PluginToolPolicyDecision, PluginToolPolicyRequest } from '@zana-ai/zcc-plugin-sdk';

const ENABLE_MARKER_PATH = '.zcc-hooks-probe-enabled';
// Same relative path the MCP child (mcp-server.ts) writes to directly via plain
// fs — it inherits the project root as its cwd and has no RPC-callback path
// into this process, so the project file is the only shared surface between
// the Modern/ACP tool and the MCP tool.
const TOOL_MARKER_PATH = '.zcc-hooks-probe/tool-marker.json';
const TOOL_MARKER_HISTORY_MAX = 20;
const LIFECYCLE_KEY = 'lifecycleEvents';
const LIFECYCLE_MAX = 50;

type DispatchSelection =
  | { kind: 'proceed' }
  | { kind: 'wait'; overrideable: boolean; reason: string }
  | { kind: 'reject'; message: string };

type ToolPolicySelection = 'allow' | 'deny';

type ToolPolicyEventRow = {
  invocationId: string;
  providerId: string;
  toolName: string;
  state: 'allowed' | 'denied';
  at: number;
};
const TOOL_POLICY_EVENTS_MAX = 50;

type ToolMarkerEntry = { source: 'modern-tool' | 'mcp-tool'; invocationId: string; at: number };
type ToolMarkerFile = { count: number; history: ToolMarkerEntry[] };
const EMPTY_TOOL_MARKER: ToolMarkerFile = { count: 0, history: [] };

type LifecycleRow = {
  eventId: string;
  schemaVersion: 1;
  occurredAt: number;
  threadId: string;
  origin: string;
  visibility: string;
};

export default function plugin(zcc: ZccPluginApi) {
  zcc.log.info('platform-hooks-probe loaded');

  let dispatchSelection: DispatchSelection = { kind: 'proceed' };
  let toolPolicySelection: ToolPolicySelection = 'allow';
  let toolPolicyEvents: ToolPolicyEventRow[] = [];

  function markerSource(projectId: string) {
    return { kind: 'workspace' as const, projectId, environmentId: null, threadId: null };
  }

  async function readMarker(projectId: string): Promise<{ enabled: boolean; sha256: string | null }> {
    try {
      const result = await zcc.sdk.files.readProject({ path: ENABLE_MARKER_PATH, source: markerSource(projectId) });
      return { enabled: result.content.trim() === '1', sha256: result.sha256 };
    } catch {
      return { enabled: false, sha256: null };
    }
  }

  zcc.rpc.method('getEnabled', async (args) => {
    const projectId = typeof (args as { projectId?: unknown } | undefined)?.projectId === 'string'
      ? (args as { projectId: string }).projectId
      : '';
    if (!projectId) throw new Error('projectId is required');
    return { enabled: (await readMarker(projectId)).enabled };
  });
  zcc.rpc.method('setEnabled', async (args) => {
    const record = args as { projectId?: unknown; enabled?: unknown } | undefined;
    const projectId = typeof record?.projectId === 'string' ? record.projectId : '';
    const enabled = Boolean(record?.enabled);
    if (!projectId) throw new Error('projectId is required');
    const current = await readMarker(projectId);
    const outcome = await zcc.sdk.files.writeProject({
      path: ENABLE_MARKER_PATH,
      source: markerSource(projectId),
      content: enabled ? '1' : '0',
      expectedSha256: current.sha256
    });
    if (outcome.outcome === 'conflict') throw new Error('Hooks Probe marker changed concurrently; retry');
    zcc.realtime.publish('hooks-probe-availability-changed', { projectId, enabled });
    return { enabled };
  });

  zcc.ui.registerProjectTabAvailability({
    tabId: 'hooks-probe',
    async evaluate(ctx) {
      const available = (await readMarker(ctx.projectId)).enabled;
      if (available) return { available: true };
      return { available: false, reason: 'Hooks Probe is not enabled for this project' };
    }
  });

  zcc.rpc.method('hostInspectContext', async (args) => {
    const projectId = typeof (args as { projectId?: unknown } | undefined)?.projectId === 'string'
      ? (args as { projectId: string }).projectId
      : '';
    if (!projectId) throw new Error('projectId is required');
    const { result } = await zcc.host.projectCall({ projectId, method: 'inspectContext' });
    return result;
  });

  const slowProbeControllers = new Map<string, AbortController>();
  zcc.rpc.method('hostSlowProbe', async (args) => {
    const record = args as { delayMs?: unknown; probeId?: unknown } | undefined;
    const delayMs = typeof record?.delayMs === 'number' ? record.delayMs : 2000;
    const probeId = typeof record?.probeId === 'string' ? record.probeId : '';
    if (!probeId) throw new Error('probeId is required');
    const defaultHost = await zcc.sdk.system.defaultHost();
    if (!defaultHost) throw new Error('no enrolled host is available for this probe');
    const client = zcc.host.experimental_client();
    const controller = new AbortController();
    slowProbeControllers.set(probeId, controller);
    try {
      const result = await client.call('slowProbe', { delayMs }, { hostId: defaultHost.id, signal: controller.signal });
      return result;
    } finally {
      slowProbeControllers.delete(probeId);
    }
  });
  zcc.rpc.method('hostCancelSlowProbe', (args) => {
    const probeId = typeof (args as { probeId?: unknown } | undefined)?.probeId === 'string'
      ? (args as { probeId: string }).probeId
      : '';
    const controller = probeId ? slowProbeControllers.get(probeId) : undefined;
    controller?.abort();
    return { cancelled: Boolean(controller) };
  });

  zcc.rpc.method('interactionUpsert', async (args) => {
    const record = args as { projectId?: unknown; correlationId?: unknown } | undefined;
    const projectId = typeof record?.projectId === 'string' ? record.projectId : '';
    const correlationId = typeof record?.correlationId === 'string' ? record.correlationId : '';
    if (!projectId || !correlationId) throw new Error('projectId and correlationId are required');
    return zcc.ui.interactions.upsert({ projectId, correlationId, kind: 'probe', payload: { correlationId } });
  });
  zcc.rpc.method('interactionGet', async (args) => {
    const interactionId = typeof (args as { interactionId?: unknown } | undefined)?.interactionId === 'string'
      ? (args as { interactionId: string }).interactionId
      : '';
    if (!interactionId) throw new Error('interactionId is required');
    return zcc.ui.interactions.get(interactionId);
  });
  zcc.rpc.method('interactionAcknowledge', async (args) => {
    const record = args as { interactionId?: unknown; generation?: unknown } | undefined;
    const interactionId = typeof record?.interactionId === 'string' ? record.interactionId : '';
    const generation = typeof record?.generation === 'number' ? record.generation : 0;
    if (!interactionId) throw new Error('interactionId is required');
    return zcc.ui.interactions.acknowledge({ interactionId, generation });
  });
  zcc.rpc.method('interactionCancel', async (args) => {
    const record = args as { interactionId?: unknown; generation?: unknown } | undefined;
    const interactionId = typeof record?.interactionId === 'string' ? record.interactionId : '';
    const generation = typeof record?.generation === 'number' ? record.generation : 0;
    if (!interactionId) throw new Error('interactionId is required');
    return zcc.ui.interactions.cancel({ interactionId, generation });
  });
  zcc.rpc.method('requestPendingInteraction', async (args) => {
    const threadId = typeof (args as { threadId?: unknown } | undefined)?.threadId === 'string'
      ? (args as { threadId: string }).threadId
      : '';
    if (!threadId) throw new Error('threadId is required');
    return zcc.ui.requestInput({
      threadId,
      rendererId: 'platform-hooks-probe-pending',
      title: 'Platform Hooks Probe: confirm action',
      payload: { kind: 'probe-confirmation' }
    });
  });

  zcc.rpc.method('setDispatchSelection', (args) => {
    const record = args as DispatchSelection | undefined;
    if (!record || typeof record.kind !== 'string') throw new Error('invalid dispatch selection');
    dispatchSelection = record;
    return { ok: true };
  });
  zcc.rpc.method('getDispatchSelection', () => dispatchSelection);

  zcc.hooks.on((request) => {
    const selection = dispatchSelection;
    const decision: DispatchAdmissionDecision = selection.kind === 'proceed'
      ? { action: 'proceed' }
      : selection.kind === 'wait'
        ? { action: 'wait', reason: selection.reason, overrideable: selection.overrideable }
        : { action: 'reject', message: selection.message };
    zcc.realtime.publish('hooks-probe-dispatch-event', {
      dispatchId: request.dispatchId,
      generation: request.generation,
      decision
    });
    return decision;
  });

  zcc.rpc.method('setToolPolicySelection', (args) => {
    const record = args as { selection?: unknown } | undefined;
    const selection = record?.selection === 'deny' ? 'deny' : record?.selection === 'allow' ? 'allow' : undefined;
    if (!selection) throw new Error('invalid tool policy selection');
    toolPolicySelection = selection;
    return { ok: true };
  });
  zcc.rpc.method('getToolPolicySelection', () => toolPolicySelection);
  zcc.rpc.method('toolPolicyEventsList', () => toolPolicyEvents);
  zcc.rpc.method('toolPolicyEventsClear', () => {
    toolPolicyEvents = [];
    return { ok: true };
  });

  zcc.hooks.onToolPolicy((request: PluginToolPolicyRequest) => {
    const selection = toolPolicySelection;
    const state: ToolPolicyEventRow['state'] = selection === 'allow' ? 'allowed' : 'denied';
    const decision: PluginToolPolicyDecision = selection === 'allow'
      ? { action: 'allow' }
      : { action: 'deny', reason: 'denied by fixture tool policy' };
    toolPolicyEvents = [
      ...toolPolicyEvents,
      { invocationId: request.invocationId, providerId: request.providerId, toolName: request.toolName, state, at: Date.now() }
    ].slice(-TOOL_POLICY_EVENTS_MAX);
    zcc.realtime.publish('hooks-probe-tool-policy-event', { invocationId: request.invocationId, state });
    return decision;
  });

  async function readToolMarker(projectId: string): Promise<{ marker: ToolMarkerFile; sha256: string | null }> {
    try {
      const result = await zcc.sdk.files.readProject({ path: TOOL_MARKER_PATH, source: markerSource(projectId) });
      const parsed = JSON.parse(result.content) as ToolMarkerFile;
      return { marker: parsed, sha256: result.sha256 };
    } catch {
      return { marker: EMPTY_TOOL_MARKER, sha256: null };
    }
  }

  // Confined project-file write, retried on a concurrent-writer conflict (Rule 4) —
  // the MCP child writes the same file via plain fs from a separate process, so a
  // CAS race here is expected, not exceptional.
  async function recordToolMarker(
    projectId: string,
    source: ToolMarkerEntry['source'],
    invocationId: string
  ): Promise<ToolMarkerFile> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const current = await readToolMarker(projectId);
      const next: ToolMarkerFile = {
        count: current.marker.count + 1,
        history: [...current.marker.history, { source, invocationId, at: Date.now() }].slice(-TOOL_MARKER_HISTORY_MAX)
      };
      const outcome = await zcc.sdk.files.writeProject({
        path: TOOL_MARKER_PATH,
        source: markerSource(projectId),
        content: JSON.stringify(next),
        expectedSha256: current.sha256
      });
      if (outcome.outcome === 'written') {
        zcc.realtime.publish('hooks-probe-tool-marker-changed', { projectId });
        return next;
      }
    }
    throw new Error('tool marker write did not converge after retries');
  }

  zcc.rpc.method('markerClear', async (args) => {
    const projectId = typeof (args as { projectId?: unknown } | undefined)?.projectId === 'string'
      ? (args as { projectId: string }).projectId
      : '';
    if (!projectId) throw new Error('projectId is required');
    const current = await readToolMarker(projectId);
    await zcc.sdk.files.writeProject({
      path: TOOL_MARKER_PATH,
      source: markerSource(projectId),
      content: JSON.stringify(EMPTY_TOOL_MARKER),
      expectedSha256: current.sha256
    });
    zcc.realtime.publish('hooks-probe-tool-marker-changed', { projectId });
    return { ok: true };
  });
  zcc.rpc.method('markerGet', async (args) => {
    const projectId = typeof (args as { projectId?: unknown } | undefined)?.projectId === 'string'
      ? (args as { projectId: string }).projectId
      : '';
    if (!projectId) throw new Error('projectId is required');
    return (await readToolMarker(projectId)).marker;
  });

  zcc.agents.registerTool({
    name: 'platform_hooks_probe_marker',
    description: 'Harmless probe tool. Writes a bounded marker to a fixed path inside this project; no side effects outside the fixture.',
    parameters: z.object({}).strict(),
    async execute(_input, ctx) {
      const marker = await recordToolMarker(ctx.projectId, 'modern-tool', `${ctx.threadId}:${Date.now()}`);
      return { ok: true, marker };
    }
  });

  zcc.rpc.method('capabilitiesForThread', async (args) => {
    const threadId = typeof (args as { threadId?: unknown } | undefined)?.threadId === 'string'
      ? (args as { threadId: string }).threadId
      : '';
    if (!threadId) throw new Error('threadId is required');
    return zcc.sdk.capabilities.forThread({ threadId });
  });
  zcc.rpc.method('capabilitiesForExecution', async (args) => {
    const executionId = typeof (args as { executionId?: unknown } | undefined)?.executionId === 'string'
      ? (args as { executionId: string }).executionId
      : '';
    if (!executionId) throw new Error('executionId is required');
    return zcc.sdk.capabilities.forExecution({ executionId });
  });

  async function readLifecycle(): Promise<LifecycleRow[]> {
    return (await zcc.storage.kv.get<LifecycleRow[]>(LIFECYCLE_KEY)) ?? [];
  }
  async function appendLifecycle(row: LifecycleRow): Promise<void> {
    const rows = await readLifecycle();
    const next = [...rows, row].slice(-LIFECYCLE_MAX);
    await zcc.storage.kv.set(LIFECYCLE_KEY, next);
    zcc.realtime.publish('hooks-probe-lifecycle-changed', { count: next.length });
  }
  const lifecycleEventNames = ['thread.created', 'thread.active', 'thread.idle', 'thread.failed', 'thread.archived', 'thread.deleted'] as const;
  for (const name of lifecycleEventNames) {
    zcc.events.on(name, (event) => {
      void appendLifecycle({
        eventId: event.id,
        schemaVersion: 1,
        occurredAt: event.timestamp,
        threadId: event.threadId,
        origin: name,
        visibility: event.thread?.visibility ?? 'unknown'
      });
    });
  }
  zcc.rpc.method('lifecycleList', () => readLifecycle());
  zcc.rpc.method('lifecycleClear', async () => {
    await zcc.storage.kv.set(LIFECYCLE_KEY, []);
    return { ok: true };
  });

  const PROBE_REVIEWER_PERSONA_ID = 'ext:platform-hooks-probe:probe-reviewer';
  zcc.agents.registerPersonas([
    {
      id: 'probe-reviewer',
      name: 'Probe Reviewer',
      description: 'Fixture persona contributed by platform-hooks-probe.',
      baseProfile: 'claude'
    }
  ]);
  zcc.agents.registerTeams([
    {
      name: 'Probe Pair',
      description: 'Fixture team contributed by platform-hooks-probe.',
      slots: [{ personaId: PROBE_REVIEWER_PERSONA_ID, quantity: 1 }]
    }
  ]);

  zcc.rpc.method('resetProbeState', async (args) => {
    const projectId = typeof (args as { projectId?: unknown } | undefined)?.projectId === 'string'
      ? (args as { projectId: string }).projectId
      : '';
    if (projectId) {
      const current = await readToolMarker(projectId);
      await zcc.sdk.files.writeProject({
        path: TOOL_MARKER_PATH,
        source: markerSource(projectId),
        content: JSON.stringify(EMPTY_TOOL_MARKER),
        expectedSha256: current.sha256
      });
      zcc.realtime.publish('hooks-probe-tool-marker-changed', { projectId });
    }
    await zcc.storage.kv.set(LIFECYCLE_KEY, []);
    dispatchSelection = { kind: 'proceed' };
    return { ok: true };
  });
}
