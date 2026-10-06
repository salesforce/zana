import { z } from 'zod';
import type { ZccPluginApi } from '@zana-ai/zcc-plugin-sdk/server';
import type { DispatchAdmissionDecision, PluginToolPolicyDecision, PluginToolPolicyRequest } from '@zana-ai/zcc-plugin-sdk';

const ENABLE_MARKER_PATH = '.zcc-hooks-probe-enabled';
const TOOL_MARKER_PATH = '.zcc-hooks-probe/tool-marker.json';
const MCP_JOURNAL_PATH = '.zcc-hooks-probe/mcp-invocations.jsonl';
const TOOL_MARKER_HISTORY_MAX = 20;
const MCP_JOURNAL_MAX_BYTES = 1024 * 1024;
const DISPATCH_EVENTS_MAX = 20;
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
type ToolMarkerFile = { count: number; history: ToolMarkerEntry[]; mcpOffset: number };
const EMPTY_TOOL_MARKER: ToolMarkerFile = { count: 0, history: [], mcpOffset: 0 };

function parseToolMarker(value: unknown): ToolMarkerFile {
  if (!value || typeof value !== 'object') throw new Error('tool marker is corrupt');
  const row = value as Partial<ToolMarkerFile>;
  if (!Number.isSafeInteger(row.count) || row.count! < 0 ||
    !Array.isArray(row.history) || row.history.length > TOOL_MARKER_HISTORY_MAX ||
    !row.history.every((entry) => entry && (entry.source === 'modern-tool' || entry.source === 'mcp-tool') &&
      typeof entry.invocationId === 'string' && Number.isFinite(entry.at)) ||
    (row.mcpOffset !== undefined && (!Number.isSafeInteger(row.mcpOffset) || row.mcpOffset < 0))) {
    throw new Error('tool marker is corrupt');
  }
  return { count: row.count!, history: row.history, mcpOffset: row.mcpOffset ?? 0 };
}

function isMissingFile(error: unknown): boolean {
  return (error as { code?: string })?.code === 'path_not_found' &&
    (error as Error)?.message?.startsWith('Path does not exist:');
}

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
  let dispatchEvents: Array<{ dispatchId: string; generation: number; decision: DispatchAdmissionDecision }> = [];
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
    const controller = new AbortController();
    slowProbeControllers.set(probeId, controller);
    try {
      const defaultHost = await zcc.sdk.system.defaultHost();
      if (!defaultHost) throw new Error('no enrolled host is available for this probe');
      // The isolated plugin worker proxies this factory asynchronously.
      const client = await zcc.host.experimental_client();
      const result = await client.call('slowProbe', { delayMs }, { hostId: defaultHost.id, signal: controller.signal });
      return result;
    } catch (error) {
      if (controller.signal.aborted) return { cancelled: true };
      throw error;
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
  zcc.rpc.method('dispatchEventsList', () => dispatchEvents);

  zcc.hooks.on((request) => {
    const selection = dispatchSelection;
    const decision: DispatchAdmissionDecision = selection.kind === 'proceed'
      ? { action: 'proceed' }
      : selection.kind === 'wait'
        ? { action: 'wait', reason: selection.reason, overrideable: selection.overrideable }
        : { action: 'reject', message: selection.message };
    const event = {
      dispatchId: request.dispatchId,
      generation: request.generation,
      decision
    };
    dispatchEvents = [...dispatchEvents, event].slice(-DISPATCH_EVENTS_MAX);
    zcc.realtime.publish('hooks-probe-dispatch-event', event);
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
    let result;
    try {
      result = await zcc.sdk.files.readProject({ path: TOOL_MARKER_PATH, source: markerSource(projectId) });
    } catch (error) {
      if (isMissingFile(error)) return { marker: EMPTY_TOOL_MARKER, sha256: null };
      throw error;
    }
    try {
      return { marker: parseToolMarker(JSON.parse(result.content)), sha256: result.sha256 };
    } catch { throw new Error('tool marker is corrupt'); }
  }

  async function readMcpJournal(projectId: string): Promise<ToolMarkerEntry[]> {
    let result;
    try {
      result = await zcc.sdk.files.readProject({ path: MCP_JOURNAL_PATH, source: markerSource(projectId) });
    } catch (error) {
      if (isMissingFile(error)) return [];
      throw error;
    }
    if (Buffer.byteLength(result.content) > MCP_JOURNAL_MAX_BYTES) throw new Error('MCP marker journal is full');
    try {
      if (result.content && !result.content.endsWith('\n')) throw new Error('incomplete journal');
      return result.content.trimEnd().split('\n').filter(Boolean).map((line) => {
        const entry = JSON.parse(line) as ToolMarkerEntry;
        if (entry.source !== 'mcp-tool' || typeof entry.invocationId !== 'string' || !Number.isFinite(entry.at)) {
          throw new Error('invalid entry');
        }
        return entry;
      });
    } catch { throw new Error('MCP marker journal is corrupt'); }
  }

  async function visibleToolMarker(projectId: string): Promise<{ count: number; history: ToolMarkerEntry[] }> {
    const { marker } = await readToolMarker(projectId);
    const journal = await readMcpJournal(projectId);
    if (marker.mcpOffset > journal.length) throw new Error('MCP marker journal is corrupt');
    const entries = journal.slice(marker.mcpOffset);
    return {
      count: marker.count + entries.length,
      history: [...marker.history, ...entries].sort((a, b) => a.at - b.at).slice(-TOOL_MARKER_HISTORY_MAX)
    };
  }

  // Only the server writes this file. MCP appends to a separate journal so
  // cross-process invocations cannot overwrite a CAS-protected update.
  async function recordToolMarker(
    projectId: string,
    source: ToolMarkerEntry['source'],
    invocationId: string
  ): Promise<{ count: number; history: ToolMarkerEntry[] }> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const current = await readToolMarker(projectId);
      const next: ToolMarkerFile = {
        count: current.marker.count + 1,
        history: [...current.marker.history, { source, invocationId, at: Date.now() }].slice(-TOOL_MARKER_HISTORY_MAX),
        mcpOffset: current.marker.mcpOffset
      };
      const outcome = await zcc.sdk.files.writeProject({
        path: TOOL_MARKER_PATH,
        source: markerSource(projectId),
        content: JSON.stringify(next),
        expectedSha256: current.sha256
      });
      if (outcome.outcome === 'written') {
        zcc.realtime.publish('hooks-probe-tool-marker-changed', { projectId });
        return visibleToolMarker(projectId);
      }
    }
    throw new Error('tool marker write did not converge after retries');
  }

  async function clearToolMarker(projectId: string): Promise<void> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const journal = await readMcpJournal(projectId);
      const current = await readToolMarker(projectId);
      const outcome = await zcc.sdk.files.writeProject({
        path: TOOL_MARKER_PATH,
        source: markerSource(projectId),
        content: JSON.stringify({ ...EMPTY_TOOL_MARKER, mcpOffset: journal.length }),
        expectedSha256: current.sha256
      });
      if (outcome.outcome === 'written') {
        zcc.realtime.publish('hooks-probe-tool-marker-changed', { projectId });
        return;
      }
    }
    throw new Error('tool marker clear did not converge after retries');
  }

  zcc.rpc.method('markerClear', async (args) => {
    const projectId = typeof (args as { projectId?: unknown } | undefined)?.projectId === 'string'
      ? (args as { projectId: string }).projectId
      : '';
    if (!projectId) throw new Error('projectId is required');
    await clearToolMarker(projectId);
    return { ok: true };
  });
  zcc.rpc.method('markerGet', async (args) => {
    const projectId = typeof (args as { projectId?: unknown } | undefined)?.projectId === 'string'
      ? (args as { projectId: string }).projectId
      : '';
    if (!projectId) throw new Error('projectId is required');
    return visibleToolMarker(projectId);
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
      await clearToolMarker(projectId);
    }
    await zcc.storage.kv.set(LIFECYCLE_KEY, []);
    dispatchSelection = { kind: 'proceed' };
    dispatchEvents = [];
    toolPolicySelection = 'allow';
    toolPolicyEvents = [];
    return { ok: true };
  });
}
