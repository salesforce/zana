import { useEffect, useState } from 'react';
import {
  callPluginRpc,
  definePluginApp,
  useRealtime,
  useRpc,
  useZccContext,
  type PluginPendingInteractionProps
} from '@zana-ai/zcc-plugin-sdk/app';

const PLUGIN_ID = 'platform-hooks-probe';

function Section(props: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ border: '1px solid var(--border, #333)', borderRadius: 8, padding: 16, marginBottom: 16 }}>
      <h3 style={{ marginTop: 0 }}>{props.title}</h3>
      {props.children}
    </section>
  );
}

function ErrorText(props: { error: string | null }) {
  if (!props.error) return null;
  return <p style={{ color: 'var(--text-danger, #c33)' }}>{props.error}</p>;
}

function HostRpcSection() {
  const rpc = useRpc();
  const { projectId } = useZccContext();
  const [context, setContext] = useState<Record<string, unknown> | null>(null);
  const [probe, setProbe] = useState<{ probeId: string; status: string; elapsedMs?: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runInspect = () => {
    setError(null);
    if (!projectId) { setError('No project is scoped to this panel'); return; }
    void rpc.call('hostInspectContext', { projectId }).then(
      (value) => setContext(value as Record<string, unknown>),
      (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause))
    );
  };

  const runSlowProbe = () => {
    setError(null);
    const probeId = `probe-${Date.now()}`;
    setProbe({ probeId, status: 'running' });
    void rpc.call('hostSlowProbe', { delayMs: 3000, probeId }).then(
      (value) => setProbe({ probeId, status: 'completed', elapsedMs: (value as { elapsedMs: number }).elapsedMs }),
      (cause: unknown) => {
        setProbe({ probeId, status: 'failed' });
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    );
  };

  const cancelSlowProbe = () => {
    if (!probe) return;
    void rpc.call('hostCancelSlowProbe', { probeId: probe.probeId }).then(() => {
      setProbe((current) => (current ? { ...current, status: 'cancelled' } : current));
    });
  };

  return (
    <Section title="Project Host RPC">
      <p>projectId: {projectId ?? 'none'}</p>
      {context ? <pre>{JSON.stringify(context, null, 2)}</pre> : null}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" onClick={runInspect}>Run host probe</button>
        <button type="button" onClick={runSlowProbe}>Start slow probe</button>
        <button type="button" onClick={cancelSlowProbe} disabled={!probe || probe.status !== 'running'}>Cancel slow probe</button>
      </div>
      {probe ? <p>slow probe {probe.probeId}: {probe.status}{probe.elapsedMs != null ? ` (${probe.elapsedMs}ms)` : ''}</p> : null}
      <ErrorText error={error} />
    </Section>
  );
}

function InteractionsSection() {
  const rpc = useRpc();
  const { threadId, projectId } = useZccContext();
  const [correlationId, setCorrelationId] = useState('demo-correlation');
  const [interaction, setInteraction] = useState<Record<string, unknown> | null>(null);
  const [pendingResult, setPendingResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = (method: string, args: Record<string, unknown>) => {
    setError(null);
    void rpc.call(method, args).then(
      (value) => setInteraction(value as Record<string, unknown>),
      (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause))
    );
  };

  const requestPending = () => {
    setError(null);
    if (!threadId) { setError('No thread is scoped to this panel'); return; }
    void rpc.call('requestPendingInteraction', { threadId }).then(
      (value) => setPendingResult(JSON.stringify(value)),
      (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause))
    );
  };

  return (
    <Section title="Interactions">
      <input value={correlationId} onChange={(event) => setCorrelationId(event.target.value)} aria-label="Correlation id" />
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button type="button" onClick={() => projectId && run('interactionUpsert', { projectId, correlationId })}>Create/Upsert</button>
        <button type="button" onClick={() => interaction && run('interactionAcknowledge', { interactionId: interaction.id, generation: interaction.generation })}>Acknowledge</button>
        <button type="button" onClick={() => interaction && run('interactionCancel', { interactionId: interaction.id, generation: interaction.generation })}>Cancel</button>
        <button type="button" onClick={requestPending}>Request pending interaction</button>
      </div>
      {interaction ? <pre>{JSON.stringify(interaction, null, 2)}</pre> : null}
      {pendingResult ? <p>pending interaction result: {pendingResult}</p> : null}
      <ErrorText error={error} />
    </Section>
  );
}

function DispatchPolicySection() {
  const rpc = useRpc();
  const [kind, setKind] = useState<'proceed' | 'wait' | 'reject'>('proceed');
  const [overrideable, setOverrideable] = useState(true);
  const [reason, setReason] = useState('demo wait reason');
  const [events, setEvents] = useState<Array<{ dispatchId: string; generation: number; decision: unknown }>>([]);

  useRealtime('hooks-probe-dispatch-event', (payload) => {
    setEvents((current) => [...current.slice(-19), payload as { dispatchId: string; generation: number; decision: unknown }]);
  });

  const apply = () => {
    const selection =
      kind === 'proceed'
        ? { kind: 'proceed' as const }
        : kind === 'wait'
          ? { kind: 'wait' as const, overrideable, reason }
          : { kind: 'reject' as const, message: reason };
    void rpc.call('setDispatchSelection', selection);
  };

  return (
    <Section title="Dispatch Policy">
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>
          <option value="proceed">Proceed</option>
          <option value="wait">Wait</option>
          <option value="reject">Reject</option>
        </select>
        {kind === 'wait' ? (
          <label>
            <input type="checkbox" checked={overrideable} onChange={(event) => setOverrideable(event.target.checked)} /> overrideable
          </label>
        ) : null}
        {kind !== 'proceed' ? (
          <input value={reason} onChange={(event) => setReason(event.target.value)} aria-label="Reason" />
        ) : null}
        <button type="button" onClick={apply}>Apply</button>
      </div>
      <table>
        <thead><tr><th>dispatchId</th><th>generation</th><th>decision</th></tr></thead>
        <tbody>
          {events.map((event, index) => (
            <tr key={`${event.dispatchId}-${index}`}>
              <td>{event.dispatchId}</td>
              <td>{event.generation}</td>
              <td>{JSON.stringify(event.decision)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

function ToolPolicySection() {
  const rpc = useRpc();
  const { projectId } = useZccContext();
  const [marker, setMarker] = useState<{ count: number; history: Array<{ source: string; invocationId: string; at: number }> } | null>(null);
  const [selection, setSelection] = useState<'allow' | 'deny'>('allow');
  const [policyEvents, setPolicyEvents] = useState<Array<{ invocationId: string; providerId: string; toolName: string; state: string; at: number }>>([]);
  const [error, setError] = useState<string | null>(null);

  const refetch = () => {
    if (!projectId) return;
    void rpc.call('markerGet', { projectId }).then(
      (value) => setMarker(value as typeof marker),
      (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause))
    );
  };

  const refetchPolicySelection = () => {
    void rpc.call('getToolPolicySelection').then((value) => setSelection(value as 'allow' | 'deny'));
  };

  const refetchPolicyEvents = () => {
    void rpc.call('toolPolicyEventsList').then((value) => setPolicyEvents(value as typeof policyEvents));
  };

  useEffect(refetch, [rpc, projectId]);
  useEffect(refetchPolicySelection, [rpc]);
  useEffect(refetchPolicyEvents, [rpc]);
  useRealtime('hooks-probe-tool-marker-changed', refetch);
  useRealtime('hooks-probe-tool-policy-event', refetchPolicyEvents);

  const clear = () => projectId && void rpc.call('markerClear', { projectId }).then(refetch);
  const last = marker?.history[marker.history.length - 1];

  const applySelection = (next: 'allow' | 'deny') => {
    setSelection(next);
    void rpc.call('setToolPolicySelection', { selection: next });
  };

  const clearPolicyEvents = () => void rpc.call('toolPolicyEventsClear').then(refetchPolicyEvents);

  return (
    <Section title="Tool Policy">
      <p>
        Agent tool <code>platform_hooks_probe_marker</code> and MCP tool <code>platform-hooks-probe</code> both record a
        bounded marker at <code>.zcc-hooks-probe/tool-marker.json</code> in this project. Invoke either from a thread, then refresh.
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" onClick={refetch}>Refresh marker</button>
        <button type="button" onClick={clear}>Clear marker</button>
      </div>
      {marker ? <p>count: {marker.count}, last source: {last?.source ?? 'none'}, last invocationId: {last?.invocationId ?? 'none'}</p> : <p>No marker yet</p>}
      <ErrorText error={error} />
      <h4>Native Tool Policy (OBL-004)</h4>
      <p>
        Decision applied to every native-provider tool call (Claude/Codex PreToolUse) routed through this plugin's{' '}
        <code>onToolPolicy</code> hook.
      </p>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <select value={selection} onChange={(event) => applySelection(event.target.value as 'allow' | 'deny')}>
          <option value="allow">Allow</option>
          <option value="deny">Deny</option>
        </select>
        <button type="button" onClick={refetchPolicyEvents}>Refresh events</button>
        <button type="button" onClick={clearPolicyEvents}>Clear events</button>
      </div>
      <table>
        <thead><tr><th>invocationId</th><th>providerId</th><th>toolName</th><th>state</th><th>at</th></tr></thead>
        <tbody>
          {policyEvents.map((event, index) => (
            <tr key={`${event.invocationId}-${index}`}>
              <td>{event.invocationId}</td>
              <td>{event.providerId}</td>
              <td>{event.toolName}</td>
              <td>{event.state}</td>
              <td>{new Date(event.at).toLocaleTimeString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

function CapabilitiesSection() {
  const rpc = useRpc();
  const { threadId } = useZccContext();
  const [capabilities, setCapabilities] = useState<unknown>(null);
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    setError(null);
    if (!threadId) { setError('No thread is scoped to this panel'); return; }
    void rpc.call('capabilitiesForThread', { threadId }).then(
      (value) => { setCapabilities(value); setRefreshedAt(Date.now()); },
      (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause))
    );
  };

  return (
    <Section title="Capabilities">
      <button type="button" onClick={refresh}>Refresh</button>
      {refreshedAt ? <p>refreshed at {new Date(refreshedAt).toLocaleTimeString()}</p> : null}
      {capabilities ? <pre>{JSON.stringify(capabilities, null, 2)}</pre> : null}
      <ErrorText error={error} />
    </Section>
  );
}

function LifecycleSection() {
  const rpc = useRpc();
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);

  const refetch = () => {
    void rpc.call('lifecycleList').then((value) => setRows(Array.isArray(value) ? (value as Array<Record<string, unknown>>) : []));
  };

  useEffect(refetch, [rpc]);
  useRealtime('hooks-probe-lifecycle-changed', refetch);

  const clear = () => void rpc.call('lifecycleClear').then(refetch);

  return (
    <Section title="Lifecycle">
      <button type="button" onClick={clear}>Clear local projection</button>
      <table>
        <thead><tr><th>eventId</th><th>schema</th><th>time</th><th>thread</th><th>origin</th><th>visibility</th></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={String(row.eventId)}>
              <td>{String(row.eventId)}</td>
              <td>{String(row.schemaVersion)}</td>
              <td>{new Date(Number(row.occurredAt)).toLocaleTimeString()}</td>
              <td>{String(row.threadId)}</td>
              <td>{String(row.origin)}</td>
              <td>{String(row.visibility)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

function ContributionsSection() {
  return (
    <Section title="Contributions">
      <p>Expected fixture persona: <code>Probe Reviewer</code></p>
      <p>Expected fixture team: <code>Probe Pair</code></p>
      <p>Verify registration status in the Agents launcher's persona/team picker.</p>
    </Section>
  );
}

function AvailabilitySection() {
  const { projectId } = useZccContext();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const rpc = useRpc();

  const refetch = () => {
    if (!projectId) return;
    void rpc.call('getEnabled', { projectId }).then((value) => setEnabled((value as { enabled: boolean }).enabled));
  };

  useEffect(refetch, [rpc, projectId]);
  useRealtime('hooks-probe-availability-changed', refetch);

  return (
    <Section title="Availability">
      <p>project: {projectId ?? 'none'}</p>
      <p>Hooks Probe is {enabled ? 'enabled' : 'disabled'} for this project. Toggle via the project overflow menu action.</p>
    </Section>
  );
}

function HooksProbePanel() {
  const rpc = useRpc();
  const { projectId } = useZccContext();

  const reset = () => void rpc.call('resetProbeState', { projectId });

  return (
    <div style={{ padding: 24, height: '100%', boxSizing: 'border-box', overflow: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>Platform Hooks Probe</h2>
        <button type="button" onClick={reset}>Reset probe state</button>
      </div>
      <HostRpcSection />
      <InteractionsSection />
      <DispatchPolicySection />
      <ToolPolicySection />
      <CapabilitiesSection />
      <LifecycleSection />
      <ContributionsSection />
      <AvailabilitySection />
    </div>
  );
}

function HooksProbePendingInteraction(props: PluginPendingInteractionProps) {
  const payload = props.interaction.payload && typeof props.interaction.payload === 'object'
    ? (props.interaction.payload as Record<string, unknown>)
    : {};
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <p>{props.interaction.title}</p>
      <pre>{JSON.stringify(payload, null, 2)}</pre>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" onClick={() => void props.submit({ confirmed: true })}>Submit</button>
        <button type="button" onClick={() => void props.cancel()}>Cancel</button>
      </div>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.projectTab({
    id: 'hooks-probe',
    label: 'Hooks Probe',
    component: HooksProbePanel
  });

  app.slots.pendingInteraction({
    id: 'platform-hooks-probe-pending',
    component: HooksProbePendingInteraction
  });

  app.slots.experimental_projectMenuAction({
    id: 'toggle-hooks-probe',
    title: 'Enable/Disable Hooks Probe',
    placement: 'project',
    async run(ctx) {
      if (!ctx.projectId) return;
      const projectId = ctx.projectId;
      const current = (await callPluginRpc(PLUGIN_ID, 'getEnabled', { projectId })) as { enabled: boolean };
      const next = (await callPluginRpc(PLUGIN_ID, 'setEnabled', { projectId, enabled: !current.enabled })) as { enabled: boolean };
      if (!next.enabled) ctx.toProject(projectId);
    }
  });
});
