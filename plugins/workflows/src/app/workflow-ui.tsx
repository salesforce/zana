import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, GitBranch, PanelRight } from 'lucide-react';
import {
  useRealtime,
  useRpc,
  useZccNavigate,
  useComposerView,
  type PluginMessageDirectiveProps,
  type PluginThreadPanelProps
} from '@zana-ai/zcc-plugin-sdk/app';
import {
  WORKFLOW_RUNS_REALTIME_CHANNEL,
  workflowRunsSignalThreadId
} from '../realtime-channel.js';
import type { WorkflowCallView, WorkflowRunView } from '../ui-contract.js';

export const WORKFLOW_PANEL_ACTION_ID = 'workflow-run';
const ACTIVE_POLL_INTERVAL_MS = 1_000;

type RunLoadState =
  | { status: 'loading' }
  | { status: 'ready'; run: WorkflowRunView | null; refreshError: string | null }
  | { status: 'error'; message: string };

type ActiveRunsLoadState =
  | { status: 'loading' }
  | { status: 'ready'; runs: WorkflowRunView[] }
  | { status: 'error' };

function requireRunId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const runId = value.trim();
  return /^wfr_[0-9a-f-]+$/i.test(runId) ? runId : null;
}

function isRunActive(run: WorkflowRunView): boolean {
  return run.status === 'queued' || run.status === 'running';
}

function composerThreadId(view: ReturnType<typeof useComposerView>): string | null {
  if (view.scope.kind === 'thread' || view.scope.kind === 'queued-message') {
    return view.scope.threadId;
  }
  if (view.scope.kind === 'side-chat') {
    return view.scope.childThreadId ?? view.scope.parentThreadId;
  }
  return null;
}

function threadIdFromHostBanner(node: HTMLElement | null): string | null {
  const id = node?.closest('[data-composer-thread]')?.getAttribute('data-composer-thread')?.trim();
  return id || null;
}

function threadIdFromLocation(): string | null {
  if (typeof window === 'undefined') return null;
  const match = window.location.pathname.match(/\/threads\/([^/]+)/);
  const id = match?.[1]?.trim() ?? '';
  if (!id || id === 'new') return null;
  return id;
}

function callWorkflowsRpc(
  rpc: ReturnType<typeof useRpc>,
  method: string,
  args: unknown
): Promise<unknown> {
  return rpc.call(method, args).catch((error: unknown) => {
    const host = (globalThis as {
      __ZCC_PLUGIN_HOST__?: {
        callRpc(pluginId: string, method: string, args?: unknown): Promise<unknown>;
      };
    }).__ZCC_PLUGIN_HOST__;
    if (!host) throw error;
    return host.callRpc('workflows', method, args);
  });
}

function callStateLabel(status: WorkflowCallView['status']): string {
  switch (status) {
    case 'queued':
      return 'queued';
    case 'running':
      return 'running';
    case 'succeeded':
      return 'done';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
  }
}

function useWorkflowRun(threadId: string, runId: string | null): {
  state: RunLoadState;
  refresh: () => Promise<void>;
} {
  const rpc = useRpc();
  const [state, setState] = useState<RunLoadState>({ status: 'loading' });
  const requestSequence = useRef(0);

  const refresh = useCallback(async () => {
    const sequence = ++requestSequence.current;
    try {
      const result = (await callWorkflowsRpc(rpc, 'workflowRunView', { threadId, runId })) as {
        run: WorkflowRunView | null;
      };
      if (sequence === requestSequence.current) {
        setState({ status: 'ready', run: result.run, refreshError: null });
      }
    } catch (error) {
      if (sequence !== requestSequence.current) return;
      const message = error instanceof Error ? error.message : String(error);
      setState((current) =>
        current.status === 'ready'
          ? { ...current, refreshError: message }
          : { status: 'error', message }
      );
    }
  }, [rpc, runId, threadId]);

  useEffect(() => {
    setState({ status: 'loading' });
    void refresh();
    return () => {
      requestSequence.current += 1;
    };
  }, [refresh]);

  useRealtime(WORKFLOW_RUNS_REALTIME_CHANNEL, (payload) => {
    if (workflowRunsSignalThreadId(payload) === threadId) void refresh();
  });

  useEffect(() => {
    if (state.status !== 'ready' || state.run === null || !isRunActive(state.run)) return;
    const timeout = window.setInterval(() => {
      void refresh();
    }, ACTIVE_POLL_INTERVAL_MS);
    return () => window.clearInterval(timeout);
  }, [refresh, state]);

  return { state, refresh };
}

function useActiveWorkflowRuns(threadId: string): {
  state: ActiveRunsLoadState;
  setRuns: (update: (runs: WorkflowRunView[]) => WorkflowRunView[]) => void;
} {
  const rpc = useRpc();
  const [state, setState] = useState<ActiveRunsLoadState>({ status: 'loading' });
  const requestSequence = useRef(0);

  const refresh = useCallback(async () => {
    const sequence = ++requestSequence.current;
    try {
      const result = (await callWorkflowsRpc(rpc, 'workflowActiveRuns', { threadId })) as {
        runs: WorkflowRunView[];
      };
      if (sequence === requestSequence.current) {
        setState({ status: 'ready', runs: result.runs });
      }
    } catch {
      if (sequence === requestSequence.current) setState({ status: 'error' });
    }
  }, [rpc, threadId]);

  useEffect(() => {
    setState({ status: 'loading' });
    void refresh();
    return () => {
      requestSequence.current += 1;
    };
  }, [refresh]);

  useRealtime(WORKFLOW_RUNS_REALTIME_CHANNEL, (payload) => {
    if (workflowRunsSignalThreadId(payload) === threadId) void refresh();
  });

  useEffect(() => {
    // The host plugin runtime currently stubs useRealtime, so a banner that
    // mounted before the first run would otherwise stay empty forever.
    const timeout = window.setInterval(() => {
      void refresh();
    }, ACTIVE_POLL_INTERVAL_MS);
    return () => window.clearInterval(timeout);
  }, [refresh]);

  const setRuns = useCallback((update: (runs: WorkflowRunView[]) => WorkflowRunView[]) => {
    setState((current) =>
      current.status === 'ready' ? { status: 'ready', runs: update(current.runs) } : current
    );
  }, []);

  return { state, setRuns };
}

function CallList({
  calls,
  onOpen
}: {
  calls: readonly WorkflowCallView[];
  onOpen: (threadId: string) => void;
}) {
  if (calls.length === 0) return null;
  return (
    <div>
      {calls.map((call) => (
        <div
          key={call.id}
          className={`wf-call${call.childThreadId ? ' is-actionable' : ''}`}
        >
          <span className="wf-pill">{callStateLabel(call.status)}</span>
          {call.childThreadId ? (
            <button type="button" onClick={() => onOpen(call.childThreadId!)}>
              {call.label}
            </button>
          ) : (
            <span>{call.label}</span>
          )}
          {call.cached ? <span className="wf-pill">cached</span> : null}
        </div>
      ))}
    </div>
  );
}

function RunBody({ run }: { run: WorkflowRunView }) {
  const navigate = useZccNavigate();
  const open = (threadId: string) => navigate.toThread(threadId);
  return (
    <>
      {run.phases.map((phase) => (
        <section key={phase.title} className="wf-phase">
          <h4>{phase.title}</h4>
          {phase.detail ? <p className="wf-muted">{phase.detail}</p> : null}
          <CallList calls={phase.calls} onOpen={open} />
        </section>
      ))}
      {run.unphasedCalls.length > 0 ? (
        <section className="wf-phase">
          <h4>Other work</h4>
          <CallList calls={run.unphasedCalls} onOpen={open} />
        </section>
      ) : null}
    </>
  );
}

function StopButton({
  threadId,
  run,
  onStopped
}: {
  threadId: string;
  run: WorkflowRunView;
  onStopped: (next: WorkflowRunView) => void;
}) {
  const rpc = useRpc();
  const [stopping, setStopping] = useState(false);
  if (!isRunActive(run)) return null;
  return (
    <button
      type="button"
      className="wf-btn"
      disabled={stopping}
      onClick={() => {
        setStopping(true);
        void callWorkflowsRpc(rpc, 'workflowStopRun', { threadId, runId: run.id })
          .then((result) => {
            const next = (result as { run: WorkflowRunView }).run;
            onStopped(next);
          })
          .finally(() => setStopping(false));
      }}
    >
      {stopping ? 'Stopping…' : 'Stop workflow'}
    </button>
  );
}

export function WorkflowPreviewDirective({
  attributes,
  message
}: PluginMessageDirectiveProps) {
  const extra = Object.keys(attributes).some((key) => key !== 'run');
  const runId = extra ? null : requireRunId(attributes.run);
  if (runId === null) {
    return (
      <div className="wf-invalid">
        workflow-preview requires exactly one valid run attribute, e.g.{' '}
        <code>{'::workflow-preview{run="wfr_…"}'}</code>
      </div>
    );
  }
  return <WorkflowPreviewCard threadId={message.threadId} runId={runId} />;
}

function WorkflowPreviewCard({ threadId, runId }: { threadId: string; runId: string }) {
  const { state } = useWorkflowRun(threadId, runId);
  const navigate = useZccNavigate();
  const [expanded, setExpanded] = useState(false);
  const bodyId = useId();
  if (state.status === 'loading') return <div className="wf-muted">Loading workflow…</div>;
  if (state.status === 'error') return <div className="wf-error">{state.message}</div>;
  if (state.run === null) return <div className="wf-muted">Unknown workflow run.</div>;
  const run = state.run;
  return (
    <article className="wf-card" aria-label="Workflow">
      <div className="wf-card-head">
        <button
          type="button"
          className="wf-card-toggle"
          aria-expanded={expanded}
          aria-controls={bodyId}
          onClick={() => setExpanded((value) => !value)}
        >
          <GitBranch size={14} aria-hidden />
          <span className="wf-title" style={{ margin: 0 }}>
            {run.name}
          </span>
          <span className="wf-pill">{run.status}</span>
          <ChevronDown size={14} aria-hidden />
        </button>
        <button
          type="button"
          className="wf-card-open"
          aria-label={`Open workflow ${run.name} in side panel`}
          onClick={() =>
            navigate.openThreadPanel({
              actionId: WORKFLOW_PANEL_ACTION_ID,
              title: run.name,
              params: { runId: run.id }
            })
          }
        >
          <PanelRight size={14} aria-hidden />
        </button>
      </div>
      {expanded ? (
        <div id={bodyId} className="wf-card-body">
          <RunBody run={run} />
        </div>
      ) : null}
    </article>
  );
}

function WorkflowComposerCard({
  run,
  threadId,
  onStopped
}: {
  run: WorkflowRunView;
  threadId: string;
  onStopped: (next: WorkflowRunView) => void;
}) {
  const navigate = useZccNavigate();
  const [expanded, setExpanded] = useState(false);
  return (
    <section className="wf-banner-card" aria-label="Workflow">
      <div className="wf-banner-head">
        <button
          type="button"
          className="wf-banner-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          <GitBranch size={14} aria-hidden />
          <span>{run.name}</span>
          <span className="wf-pill">{run.status}</span>
          <ChevronDown size={14} aria-hidden />
        </button>
        <button
          type="button"
          className="wf-card-open"
          aria-label={`Open workflow ${run.name} in side panel`}
          onClick={() =>
            navigate.openThreadPanel({
              actionId: WORKFLOW_PANEL_ACTION_ID,
              title: run.name,
              params: { runId: run.id }
            })
          }
        >
          <PanelRight size={14} aria-hidden />
        </button>
      </div>
      {expanded ? (
        <div className="wf-card-body">
          <RunBody run={run} />
          <StopButton threadId={threadId} run={run} onStopped={onStopped} />
        </div>
      ) : null}
    </section>
  );
}

export function WorkflowStatusBanner() {
  const view = useComposerView();
  const hostRef = useRef<HTMLDivElement>(null);
  const [hostThreadId, setHostThreadId] = useState<string | null>(null);
  useLayoutEffect(() => {
    setHostThreadId(threadIdFromHostBanner(hostRef.current));
  }, []);
  const threadId = composerThreadId(view) ?? hostThreadId ?? threadIdFromLocation();
  return (
    <div ref={hostRef} data-testid="wf-banner-root" data-wf-thread={threadId ?? ''}>
      {threadId ? <WorkflowStatusBannerLoaded threadId={threadId} /> : null}
    </div>
  );
}

function WorkflowStatusBannerLoaded({ threadId }: { threadId: string }) {
  const { state, setRuns } = useActiveWorkflowRuns(threadId);
  if (state.status !== 'ready' || state.runs.length === 0) return null;
  return (
    <div className="wf-banner">
      {state.runs.map((run) => (
        <WorkflowComposerCard
          key={run.id}
          run={run}
          threadId={threadId}
          onStopped={(next) =>
            setRuns((runs) => runs.map((row) => (row.id === next.id ? next : row)))
          }
        />
      ))}
    </div>
  );
}

function panelRunId(params: unknown): string | null {
  if (params === null || typeof params !== 'object' || Array.isArray(params)) return null;
  return requireRunId((params as { runId?: unknown }).runId);
}

export function WorkflowRunPanel({ threadId, params }: PluginThreadPanelProps) {
  const runId = panelRunId(params);
  const { state, refresh } = useWorkflowRun(threadId, runId);
  let body: ReactNode;
  if (state.status === 'loading') body = <p className="wf-muted">Loading workflow…</p>;
  else if (state.status === 'error') body = <p className="wf-error">{state.message}</p>;
  else if (state.run === null) body = <p className="wf-muted">No workflow run in this thread.</p>;
  else {
    const run = state.run;
    body = (
      <>
        <h2 className="wf-title">{run.name}</h2>
        <p className="wf-muted">{run.description}</p>
        <RunBody run={run} />
        <dl className="wf-meta">
          <dt>Status</dt>
          <dd>{run.status}</dd>
          <dt>Result</dt>
          <dd>{run.resultAvailable ? 'Available' : '—'}</dd>
          {run.error ? (
            <>
              <dt>Error</dt>
              <dd className="wf-error">{run.error}</dd>
            </>
          ) : null}
        </dl>
      </>
    );
  }
  return (
    <div className="wf-panel">
      <div className="wf-panel-body">{body}</div>
      {state.status === 'ready' && state.run ? (
        <div className="wf-panel-footer">
          <StopButton
            threadId={threadId}
            run={state.run}
            onStopped={() => {
              void refresh();
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
