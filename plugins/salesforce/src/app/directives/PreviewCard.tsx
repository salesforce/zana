import { useRealtime, useZccNavigate, type PluginMessageDirectiveProps } from '@zana-ai/zcc-plugin-sdk/app';
import type { TurnTrace } from '../../../lib/studio-contract.js';
import { STUDIO_CHANGED_CHANNEL, STUDIO_RPC } from '../../../lib/studio-contract.js';
import { AGENTFORCE_PREVIEW_ACTION } from '../agentforce-panel-params.js';
import { CARD_STYLES, ErrorCard, Pill, cleanAttr, isNotImplemented, parseLine, rpc, rpcFailure, useLoaded } from './card-kit.js';

interface RunSummary { steps: number; latencyMs: number; note: string | null }

/** `::sf-preview{runId="…" turn="…"}` — a card for an Agentforce preview run. */
export function PreviewCard({ pluginId, attributes, source, message }: PluginMessageDirectiveProps) {
  const navigate = useZccNavigate();
  const runId = cleanAttr(attributes.runId ?? attributes.runid, 256);
  const turn = parseLine(attributes.turn);
  const projectId = message.projectId;
  const loaded = useLoaded<RunSummary | null>(async () => {
    if (!runId) return null;
    const result = await rpc(pluginId, STUDIO_RPC.trace, { id: runId, ...(turn ? { turn } : {}), ...(projectId ? { projectId } : {}), threadId: message.threadId });
    if (isNotImplemented(result)) return null;
    const failure = rpcFailure(result);
    if (failure) return { steps: 0, latencyMs: 0, note: failure.message };
    const trace = ((result as { data?: TurnTrace }).data ?? (result as { trace?: TurnTrace }).trace) as TurnTrace | undefined;
    if (!trace) return null;
    if (!trace.available) return { steps: 0, latencyMs: 0, note: trace.reason ?? 'No trace for this run' };
    return { steps: trace.steps.length, latencyMs: trace.steps.reduce((sum, step) => sum + (step.latencyMs ?? 0), 0), note: null };
  }, [pluginId, runId, turn, projectId, message.threadId]);
  useRealtime(STUDIO_CHANGED_CHANNEL, payload => {
    const event = payload as { projectId?: string; kind?: string } | null;
    if (event && (!event.projectId || !projectId || event.projectId === projectId) && (!event.kind || event.kind === 'suites')) loaded.reload();
  });
  if (!runId) return <ErrorCard kind="preview" message="Invalid preview link: a runId is required." source={source} />;
  const summary = loaded.data;
  const open = () => navigate.openThreadPanel({
    actionId: AGENTFORCE_PREVIEW_ACTION,
    title: 'Preview',
    params: { runId, ...(turn ? { turn: String(turn) } : {}) },
    ...(message.threadId ? { threadId: message.threadId } : {})
  });
  return (
    <div className="plugin-directive-card sf-dcard" data-testid="sf-card-preview">
      <style>{CARD_STYLES}</style>
      <button type="button" className="plugin-directive-card-main" onClick={open} title="Open this run in Preview">
        <span className="sf-dcard-icon" aria-hidden>PV</span>
        <span className="sf-dcard-body">
          <span className="sf-dcard-line">
            <span className="plugin-directive-card-kind">Preview run</span>
            <span className="plugin-directive-card-title"><code>{runId}</code></span>
            {turn ? <Pill>turn {turn}</Pill> : null}
            {summary && !summary.note ? <Pill tone="success">{summary.steps} step{summary.steps === 1 ? '' : 's'}</Pill> : null}
            {summary && !summary.note && summary.latencyMs > 0 ? <Pill>{summary.latencyMs} ms</Pill> : null}
          </span>
          <span className="sf-dcard-sub">
            {loaded.loading ? 'Loading run…' : summary?.note ? summary.note : summary ? 'Planner trace available' : 'Run summary unavailable - open to view the conversation'}
          </span>
        </span>
      </button>
    </div>
  );
}
