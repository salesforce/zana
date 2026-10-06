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
const DISPATCH_EVENTS_MAX = 20;
const fieldStyle: React.CSSProperties = {
  background: 'var(--bg-input, var(--bg-base, #202020))',
  color: 'var(--text)',
  border: '1px solid var(--border)',
  borderRadius: 4,
  padding: '6px 8px',
  minHeight: 30
};
const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 12 };

function Section(props: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ border: '1px solid var(--border, #333)', borderRadius: 8, padding: 16, marginBottom: 16, background: 'var(--bg-panel, transparent)' }}>
      <h3 style={{ marginTop: 0, fontSize: 14 }}>{props.title}</h3>
      {props.children}
    </section>
  );
}

function ErrorText(props: { error: string | null }) {
  if (!props.error) return null;
  return <p style={{ color: 'var(--text-danger, #c33)' }}>{props.error}</p>;
}

type ActionNotice = { message: string; error: boolean };

function useActionNotice() {
  const [notice, setNotice] = useState<ActionNotice | null>(null);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 3500);
    return () => clearTimeout(timer);
  }, [notice]);
  return [notice, setNotice] as const;
}

function ActionToast({ notice }: { notice: ActionNotice | null }) {
  if (!notice) return null;
  return <div role={notice.error ? 'alert' : 'status'} style={{ position: 'fixed', right: 24, bottom: 24, zIndex: 100, padding: '10px 14px', borderRadius: 6, background: 'var(--bg-panel, #222)', border: `1px solid var(${notice.error ? '--text-danger' : '--border'}, #555)`, color: 'var(--text)', boxShadow: '0 8px 24px #0006' }}>{notice.message}</div>;
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
      (value) => {
        const result = value as { cancelled?: boolean; elapsedMs?: number };
        setProbe((current) => current?.probeId === probeId
          ? { probeId, status: result.cancelled ? 'cancelled' : 'completed', elapsedMs: result.elapsedMs }
          : current);
      },
      (cause: unknown) => {
        setProbe((current) => current?.probeId === probeId ? { probeId, status: 'failed' } : current);
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    );
  };

  const cancelSlowProbe = () => {
    if (!probe || probe.status !== 'running') return;
    const probeId = probe.probeId;
    setError(null);
    setProbe({ probeId, status: 'cancelling' });
    void rpc.call('hostCancelSlowProbe', { probeId }).then(
      (value) => {
        if (!(value as { cancelled: boolean }).cancelled) {
          setProbe((current) => current?.probeId === probeId && current.status === 'cancelling'
            ? { probeId, status: 'failed' }
            : current);
          setError('Slow probe was not running when cancellation was requested');
        }
      },
      (cause: unknown) => {
        setProbe((current) => current?.probeId === probeId ? { probeId, status: 'failed' } : current);
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    );
  };

  return (
    <Section title="Project Host RPC">
      <p>projectId: {projectId ?? 'none'}</p>
      {context ? <pre>{JSON.stringify(context, null, 2)}</pre> : null}
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn" type="button" onClick={runInspect}>Run host probe</button>
        <button className="btn" type="button" onClick={runSlowProbe}>Start slow probe</button>
        <button className="btn" type="button" onClick={cancelSlowProbe} disabled={!probe || probe.status !== 'running'}>Cancel slow probe</button>
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
      <input style={fieldStyle} value={correlationId} onChange={(event) => setCorrelationId(event.target.value)} aria-label="Correlation id" />
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button className="btn" type="button" onClick={() => projectId && run('interactionUpsert', { projectId, correlationId })}>Create/Upsert</button>
        <button className="btn" type="button" disabled={!interaction} onClick={() => interaction && run('interactionAcknowledge', { interactionId: interaction.id, generation: interaction.generation })}>Acknowledge</button>
        <button className="btn" type="button" disabled={!interaction} onClick={() => interaction && run('interactionCancel', { interactionId: interaction.id, generation: interaction.generation })}>Cancel</button>
        <button className="btn" type="button" onClick={requestPending}>Request pending interaction</button>
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
  const [toast, setToast] = useActionNotice();
  const [applied, setApplied] = useState<string | null>(null);

  const refreshEvents = (notify = false) => {
    void rpc.call('dispatchEventsList').then(
      (value) => {
        setEvents((current) => {
          const byId = new Map((value as typeof events).map((event) => [event.dispatchId, event]));
          for (const event of current) byId.set(event.dispatchId, event);
           return [...byId.values()].slice(-DISPATCH_EVENTS_MAX);
        });
        if (notify) setToast({ message: 'Dispatches refreshed', error: false });
      },
      (cause: unknown) => setToast({ message: `Could not load dispatches: ${cause instanceof Error ? cause.message : String(cause)}`, error: true })
    );
  };

  useEffect(() => {
    refreshEvents();
    const poll = setInterval(refreshEvents, 5000);
    void rpc.call('getDispatchSelection').then(
      (value) => {
        const selection = value as { kind: 'proceed' | 'wait' | 'reject'; overrideable?: boolean; reason?: string; message?: string };
        setKind(selection.kind);
        setOverrideable(selection.overrideable ?? true);
        setReason(selection.reason ?? selection.message ?? 'demo wait reason');
        setApplied(selection.kind);
      },
      (cause: unknown) => setToast({ message: `Could not load dispatch policy: ${cause instanceof Error ? cause.message : String(cause)}`, error: true })
    );
    return () => clearInterval(poll);
  }, [rpc]);

  useRealtime('hooks-probe-dispatch-event', (payload) => {
     setEvents((current) => [...current.filter((event) => event.dispatchId !== (payload as { dispatchId: string }).dispatchId), payload as { dispatchId: string; generation: number; decision: unknown }].slice(-DISPATCH_EVENTS_MAX));
  });

  const apply = () => {
    const selection =
      kind === 'proceed'
        ? { kind: 'proceed' as const }
        : kind === 'wait'
          ? { kind: 'wait' as const, overrideable, reason }
          : { kind: 'reject' as const, message: reason };
    void rpc.call('setDispatchSelection', selection).then(
      () => {
        setApplied(kind);
        setToast({ message: `Dispatch policy applied: ${kind}`, error: false });
      },
      (cause: unknown) => setToast({ message: `Could not apply dispatch policy: ${cause instanceof Error ? cause.message : String(cause)}`, error: true })
    );
  };

  return (
    <Section title="Dispatch Policy">
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <select aria-label="Dispatch decision" style={fieldStyle} value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>
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
          <input style={fieldStyle} value={reason} onChange={(event) => setReason(event.target.value)} aria-label="Reason" />
        ) : null}
        <button className="btn" type="button" onClick={apply}>Apply</button>
      </div>
      <p>Server policy: {applied ?? 'loading'}</p>
      <h4 style={{ marginBottom: 4 }}>Observed thread dispatches</h4>
      <p style={{ marginTop: 0 }}>Decisions for follow-up messages in existing Modern threads. Apply sets policy; it does not add a row. New Chat's first message creates a thread and does not trigger this hook. After that thread settles, send a second message in the same thread to see a row. Recent rows refresh automatically.</p>
      <button className="btn" type="button" onClick={() => refreshEvents(true)}>Refresh dispatches</button>
      <table style={tableStyle}>
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
      {events.length === 0 ? <p>No dispatches observed yet. Send a follow-up in an existing Modern thread in this project.</p> : null}
      <ActionToast notice={toast} />
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
  const [toast, setToast] = useActionNotice();

  const refetch = (notify = false) => {
    if (!projectId) {
      if (notify) setToast({ message: 'No project is scoped to this panel', error: true });
      return;
    }
    void rpc.call('markerGet', { projectId }).then(
      (value) => {
        setMarker(value as typeof marker);
        setError(null);
        if (notify) setToast({ message: 'Tool marker refreshed', error: false });
      },
      (cause: unknown) => {
        const message = cause instanceof Error ? cause.message : String(cause);
        setError(message);
        if (notify) setToast({ message: `Could not refresh tool marker: ${message}`, error: true });
      }
    );
  };

  const refetchPolicySelection = () => {
    void rpc.call('getToolPolicySelection').then((value) => setSelection(value as 'allow' | 'deny'));
  };

  const refetchPolicyEvents = (notify = false) => {
    void rpc.call('toolPolicyEventsList').then(
      (value) => {
        setPolicyEvents(value as typeof policyEvents);
        if (notify) setToast({ message: 'Tool policy events refreshed', error: false });
      },
      (cause: unknown) => setToast({ message: `Could not refresh tool policy events: ${cause instanceof Error ? cause.message : String(cause)}`, error: true })
    );
  };

  useEffect(refetch, [rpc, projectId]);
  useEffect(refetchPolicySelection, [rpc]);
  useEffect(refetchPolicyEvents, [rpc]);
  useRealtime('hooks-probe-tool-marker-changed', () => refetch());
  useRealtime('hooks-probe-tool-policy-event', () => refetchPolicyEvents());

  const clear = () => {
    if (!projectId) return;
    void rpc.call('markerClear', { projectId }).then(
      () => {
        refetch();
        setToast({ message: 'Tool marker cleared', error: false });
      },
      (cause: unknown) => setToast({ message: `Could not clear tool marker: ${cause instanceof Error ? cause.message : String(cause)}`, error: true })
    );
  };
  const last = marker?.history[marker.history.length - 1];

  const applySelection = (next: 'allow' | 'deny') => {
    void rpc.call('setToolPolicySelection', { selection: next }).then(
      () => {
        setSelection(next);
        setToast({ message: `Tool policy set to ${next}`, error: false });
      },
      (cause: unknown) => setToast({ message: `Could not set tool policy: ${cause instanceof Error ? cause.message : String(cause)}`, error: true })
    );
  };

  const clearPolicyEvents = () => void rpc.call('toolPolicyEventsClear').then(
    () => {
      refetchPolicyEvents();
      setToast({ message: 'Tool policy events cleared', error: false });
    },
    (cause: unknown) => setToast({ message: `Could not clear tool policy events: ${cause instanceof Error ? cause.message : String(cause)}`, error: true })
  );

  return (
    <Section title="Tool Policy">
      <p>
        Agent tool <code>platform_hooks_probe_marker</code> writes a CAS marker and MCP tool <code>platform-hooks-probe</code> appends
        invocation records to a project journal. Both appear in the bounded history below. Invoke either from a thread, then refresh.
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn" type="button" onClick={() => refetch(true)}>Refresh marker</button>
        <button className="btn" type="button" onClick={clear} disabled={!projectId}>Clear marker</button>
      </div>
      {marker ? <p>count: {marker.count}, last source: {last?.source ?? 'none'}, last invocationId: {last?.invocationId ?? 'none'}</p> : <p>No marker yet</p>}
      <ErrorText error={error} />
      <ActionToast notice={toast} />
      <h4>Native Tool Policy (OBL-004)</h4>
      <p>
        Decision applied to every native-provider tool call (Claude/Codex PreToolUse) routed through this plugin's{' '}
        <code>onToolPolicy</code> hook.
      </p>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select aria-label="Tool policy" style={fieldStyle} value={selection} onChange={(event) => applySelection(event.target.value as 'allow' | 'deny')}>
          <option value="allow">Allow</option>
          <option value="deny">Deny</option>
        </select>
          <button className="btn" type="button" onClick={() => refetchPolicyEvents(true)}>Refresh events</button>
          <button className="btn" type="button" onClick={clearPolicyEvents}>Clear events</button>
      </div>
      <table style={tableStyle}>
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
      <button className="btn" type="button" onClick={refresh}>Refresh</button>
      {refreshedAt ? <p>refreshed at {new Date(refreshedAt).toLocaleTimeString()}</p> : null}
      {capabilities ? <pre>{JSON.stringify(capabilities, null, 2)}</pre> : null}
      <ErrorText error={error} />
    </Section>
  );
}

function LifecycleSection() {
  const rpc = useRpc();
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [toast, setToast] = useActionNotice();

  const refetch = () => {
    void rpc.call('lifecycleList').then((value) => setRows(Array.isArray(value) ? (value as Array<Record<string, unknown>>) : []));
  };

  useEffect(refetch, [rpc]);
  useRealtime('hooks-probe-lifecycle-changed', refetch);

  const clear = () => void rpc.call('lifecycleClear').then(
    () => {
      refetch();
      setToast({ message: 'Lifecycle projection cleared', error: false });
    },
    (cause: unknown) => setToast({ message: `Could not clear lifecycle projection: ${cause instanceof Error ? cause.message : String(cause)}`, error: true })
  );

  return (
    <Section title="Lifecycle">
      <button className="btn" type="button" onClick={clear}>Clear local projection</button>
      <table style={tableStyle}>
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
      <ActionToast notice={toast} />
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
  const [resetStatus, setResetStatus] = useState<string | null>(null);

  const reset = () => {
    setResetStatus('Resetting…');
    void rpc.call('resetProbeState', { projectId }).then(
      () => window.location.reload(),
      (cause: unknown) => setResetStatus(cause instanceof Error ? cause.message : String(cause))
    );
  };

  return (
    <div className="hooks-probe" style={{ padding: 24, height: '100%', boxSizing: 'border-box', overflow: 'auto' }}>
      <style>{`
        .hooks-probe > :not(style) { max-width: 1000px; }
        .hooks-probe section p { color: var(--text-muted, var(--text)); line-height: 1.5; }
        .hooks-probe section > div { flex-wrap: wrap; }
        .hooks-probe pre { overflow-x: auto; padding: 12px; border-radius: 4px; background: var(--bg-base, #181818); }
        .hooks-probe table { margin-top: 12px; }
        .hooks-probe th, .hooks-probe td { padding: 8px; border-bottom: 1px solid var(--border, #333); vertical-align: top; overflow-wrap: anywhere; }
        .hooks-probe th { color: var(--text-muted, var(--text)); font-weight: 600; }
        .hooks-probe button:focus-visible, .hooks-probe select:focus-visible, .hooks-probe input:focus-visible { outline: 2px solid var(--accent, #58a6ff); outline-offset: 2px; }
      `}</style>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>Platform Hooks Probe</h2>
        <div>
          <button className="btn" type="button" onClick={reset}>Reset probe state</button>
          {resetStatus && <span role="status" style={{ marginLeft: 8 }}>{resetStatus}</span>}
        </div>
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
        <button className="btn" type="button" onClick={() => void props.submit({ confirmed: true })}>Submit</button>
        <button className="btn" type="button" onClick={() => void props.cancel()}>Cancel</button>
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
    title: 'Hooks Probe',
    async titleForProject(projectId) {
      const current = (await callPluginRpc(PLUGIN_ID, 'getEnabled', { projectId })) as { enabled: boolean };
      return `${current.enabled ? 'Disable' : 'Enable'} Hooks Probe`;
    },
    placement: 'project',
    async run(ctx) {
      if (!ctx.projectId) return;
      const projectId = ctx.projectId;
      const current = (await callPluginRpc(PLUGIN_ID, 'getEnabled', { projectId })) as { enabled: boolean };
      const next = (await callPluginRpc(PLUGIN_ID, 'setEnabled', { projectId, enabled: !current.enabled })) as { enabled: boolean };
      if (next.enabled) ctx.toProject(projectId);
    }
  });
});
