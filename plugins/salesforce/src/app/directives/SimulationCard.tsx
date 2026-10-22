import { useEffect } from 'react';
import { useRealtime, useZccNavigate, type PluginMessageDirectiveProps } from '@zana-ai/zcc-plugin-sdk/app';
import { STUDIO_CHANGED_CHANNEL } from '../../../lib/studio-contract.js';
import { SIMULATION_RPC, SIMULATIONS_CHANGED_KIND, type BatchStatus, type LaneStatus, type SimulationBatch } from '../../../lib/simulation-contract.js';
import { routeStudioIntent } from '../studio/studio-intents.js';
import { CARD_STYLES, ErrorCard, Pill, rpc, rpcFailure, useLoaded, type Tone } from './card-kit.js';

/** Fallback refresh while a batch runs, for missed realtime messages. */
export const SIMULATION_POLL_MS = 3000;
const BATCH_ID = /^[A-Za-z0-9-]{1,64}$/;

const BATCH_TONE: Record<BatchStatus, Tone> = { running: 'running', done: 'success', stopped: 'warn', interrupted: 'warn' };
const BATCH_LABEL: Record<BatchStatus, string> = { running: 'Running', done: 'Done', stopped: 'Stopped', interrupted: 'Interrupted' };
const LANE_COLOR: Record<LaneStatus, string> = {
  queued: 'var(--sf-border)', running: 'var(--sf-accent)', pass: 'var(--sf-success)', fail: 'var(--sf-danger)',
  inconclusive: 'var(--sf-warn)', error: 'var(--sf-danger)', stopped: 'var(--sf-muted)',
};

const STYLES = `
.sf-dcard .sf-dcard-lanes { display:flex; gap:3px; flex-wrap:wrap; margin-top:2px; }
.sf-dcard .sf-dcard-lanes i { width:14px; height:6px; border-radius:3px; }
.sf-dcard .sf-dcard-lanes i[data-status=running] { animation:sf-dcard-pulse 1.2s ease-in-out infinite; }
`;

/** `::sf-simulation{batchId="…"}` — a live card for a Simulation lab batch; it opens the batch in Tests > Simulations. */
export function SimulationCard({ pluginId, attributes, source, message }: PluginMessageDirectiveProps) {
  const navigate = useZccNavigate();
  const raw = (attributes.batchId ?? attributes.batchid ?? attributes.id)?.trim() ?? '';
  const batchId = BATCH_ID.test(raw) ? raw : null;
  const projectId = message.projectId;
  const loaded = useLoaded<SimulationBatch | null>(async () => {
    if (!batchId) return null;
    const result = await rpc(pluginId, SIMULATION_RPC.get, { batchId, transcripts: false, ...(projectId ? { projectId } : {}), threadId: message.threadId });
    const failure = rpcFailure(result);
    if (failure) throw new Error(failure.message);
    return (result as { batch: SimulationBatch }).batch;
  }, [pluginId, batchId, projectId, message.threadId]);
  const batch = loaded.data;
  const running = batch?.status === 'running';
  const { reload } = loaded;
  useRealtime(STUDIO_CHANGED_CHANNEL, payload => {
    const event = payload as { projectId?: string; kind?: string; batchId?: string } | null;
    if (event?.kind === SIMULATIONS_CHANGED_KIND && event.batchId === batchId && (!event.projectId || !projectId || event.projectId === projectId)) reload();
  });
  useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(reload, SIMULATION_POLL_MS);
    return () => clearInterval(timer);
  }, [running, reload]);

  if (!batchId) return <ErrorCard kind="simulation" message="Invalid simulation link: a batchId is required." source={source} />;
  if (loaded.error && !batch) return <ErrorCard kind="simulation" message={`Simulation unavailable: ${loaded.error}`} source={source} />;

  const open = (from: Element | null) => {
    if (!batch) return;
    void routeStudioIntent({
      pluginId, projectId: projectId ?? null, threadId: message.threadId ?? null, from, navigate,
      intent: { kind: 'tests', path: batch.agentPath, sub: 'simulations', batchId: batch.id },
    });
  };
  const counts = batch?.counts;
  const failing = counts ? counts.fail + counts.inconclusive + counts.error : 0;
  const finished = counts ? counts.total - counts.running - counts.queued : 0;
  const agent = batch?.agentPath.split('/').pop()?.replace(/\.agent$/i, '');
  return (
    <div className="plugin-directive-card sf-dcard" data-testid="sf-card-simulation">
      <style>{CARD_STYLES + STYLES}</style>
      <button type="button" className="plugin-directive-card-main" disabled={!batch} onClick={event => open(event.currentTarget)} title="Open in Tests › Simulations">
        <span className="sf-dcard-icon" aria-hidden>SIM</span>
        <span className="sf-dcard-body">
          <span className="sf-dcard-line">
            <span className="plugin-directive-card-kind">Simulations</span>
            <span className="plugin-directive-card-title">{batch ? agent : 'Loading…'}</span>
            {batch ? <Pill tone={BATCH_TONE[batch.status]}>{BATCH_LABEL[batch.status]}{running ? ` ${finished}/${counts!.total}` : ''}</Pill> : null}
            {counts && finished ? <Pill tone={failing ? 'danger' : 'success'} title={`${counts.pass} of ${counts.total} pass`}>{counts.pass}/{counts.total} pass</Pill> : null}
            {batch ? <Pill>{batch.engine === 'preview' ? 'Simulate' : 'Rehearse'}</Pill> : null}
            {batch?.candidate ? <Pill tone="warn">draft</Pill> : null}
          </span>
          {batch
            ? <span className="sf-dcard-lanes" aria-label={batch.lanes.map(lane => `${lane.name}: ${lane.status}`).join(', ')}>
              {batch.lanes.map(lane => <i key={lane.id} data-status={lane.status} title={`${lane.name}${lane.repeat > 1 ? ` #${lane.repeat}` : ''}: ${lane.status}`} style={{ background: LANE_COLOR[lane.status] }} />)}
            </span>
            : <span className="sf-dcard-sub">Loading simulation…</span>}
        </span>
      </button>
    </div>
  );
}
