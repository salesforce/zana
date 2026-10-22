import { useRef, useState } from 'react';
import { ArrowRight, Loader2, Monitor, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { product } from '../lib/product-client.js';
import { startHostRepairAgent } from '../lib/host-repair-agent.js';
import type { HostInstallDrawerState } from '../lib/host-install-drawer.js';
import type { HostRepairTarget } from '../lib/host-install-run.js';
import { useData, useUi } from '../store.js';
import { useThreads } from '../thread-store.js';
import { inspectThread } from '../lib/inspect-session.js';
import './host-repair-agent.css';

export function HostRepairAgentAction({ state, target, onStarted }: {
  state: Pick<HostInstallDrawerState, 'target' | 'error' | 'logs' | 'stages'>;
  target: HostRepairTarget;
  onStarted?: () => void;
}) {
  const navigate = useNavigate();
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const thread = await startHostRepairAgent(product, state, target, useData.getState().defaultHarness);
      useThreads.getState().upsert(thread);
      void useData.getState().loadProjects().catch(() => {});
      const ui = useUi.getState();
      ui.setHostInstallDrawerOpen(false);
      ui.setLauncherOpen(false);
      onStarted?.();
      ui.enterProjectFocus(thread.projectId);
      inspectThread(thread.id, thread.projectId, navigate);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not start the local repair agent.');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return <section className="host-repair-agent" aria-label="Repair with a local agent">
    <h3><Sparkles size={15} aria-hidden="true" />Let an agent take a look</h3>
    <p>A local agent can read this log, find what’s wrong, and help reconnect your machine.</p>
    <button type="button" className="host-repair-agent-start" disabled={busy} onClick={() => void start()}>
      {busy ? <Loader2 size={14} className="thread-command-send-spin" aria-hidden="true" /> : <Sparkles size={14} aria-hidden="true" />}
      {busy ? 'Starting local agent…' : 'Fix with agent'}
      <ArrowRight size={14} aria-hidden="true" />
    </button>
    <span className="host-repair-agent-location"><Monitor size={12} aria-hidden="true" />Runs on this computer</span>
    {error && <p className="host-repair-agent-error" role="alert">{error}</p>}
  </section>;
}
