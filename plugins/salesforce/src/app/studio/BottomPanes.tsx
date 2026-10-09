import { useEffect, useRef, useState } from 'react';
import { callPluginRpc } from '@zana-ai/zcc-plugin-sdk/app';
import { STUDIO_RPC, type ScenarioSuite, type StudioEngine, type TurnTrace } from '../../../lib/studio-contract.js';
import { TRACE_PANEL_STYLES, TracePanel } from '../preview/TracePanel.js';
import { suiteStatus } from './useSuites.js';

/** Trace tab: the planner trace of the latest Preview run (Simulate / Live); Rehearse has no runtime trace. */
export function BottomTrace({ pluginId, path, run, visible, onRevealSource, onOpenPreview }: {
  pluginId: string;
  path: string | null;
  run: { runId: string; engine: StudioEngine; turn: number } | null;
  visible: boolean;
  onRevealSource?(path: string, line: number): void;
  onOpenPreview(): void;
}) {
  const [trace, setTrace] = useState<TurnTrace | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const runId = run?.runId; const engine = run?.engine; const turn = run?.turn;
  useEffect(() => {
    setTrace(null); setError(null);
    if (!visible || !runId || !engine || engine === 'rehearse') { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    void Promise.resolve(callPluginRpc(pluginId, STUDIO_RPC.trace, { id: runId, engine, ...(path ? { path } : {}) }))
      .then(result => {
        if (cancelled || !alive.current) return;
        const reply = result as { ok?: boolean; data?: TurnTrace; error?: string } | null;
        if (reply?.ok !== false && reply?.data) setTrace(reply.data); else setError(reply?.error || 'The trace is unavailable.');
      })
      .catch(err => { if (!cancelled && alive.current) setError(err instanceof Error ? err.message : String(err)); })
      .finally(() => { if (!cancelled && alive.current) setLoading(false); });
    return () => { cancelled = true; };
  }, [pluginId, path, runId, engine, turn, visible]);
  return <div className="sf-bottom-trace" data-testid="studio-trace-pane">
    <style>{TRACE_PANEL_STYLES}</style>
    {!run && <p className="sf-problems-empty">Run a conversation in Preview to see the planner trace.</p>}
    {run?.engine === 'rehearse' && <TracePanel trace={null} approximation />}
    {run && run.engine !== 'rehearse' && <>
      <TracePanel trace={trace} loading={loading} onRevealSource={onRevealSource} />
      {error && <p className="sf-problems-empty" role="alert">{error}</p>}
    </>}
    <div className="sf-problems-empty"><button type="button" className="sf-btn-small" onClick={onOpenPreview}>Open Preview</button></div>
  </div>;
}

/** Tests tab: saved scenario suites with their last results. */
export function BottomTests({ suites, onOpenTests }: { suites: ScenarioSuite[]; onOpenTests(): void }) {
  return <div data-testid="studio-tests-pane">
    {suites.length === 0
      ? <p className="sf-problems-empty">No scenario suites yet. Save a conversation as a scenario from Preview, or add tests/&lt;name&gt;.scenario.json.</p>
      : <ul className="sf-problems-list">
        {suites.map(suite => {
          const status = suiteStatus(suite);
          const results = Object.values(suite.lastResults ?? {});
          const passed = results.filter(result => result.outcome === 'pass').length;
          return <li key={suite.id}>
            <button type="button" className={`sf-problem${status === 'fail' ? ' is-error' : ''}`} onClick={onOpenTests}>
              <span className="sf-problem-mark" aria-hidden="true">{status === 'pass' ? '✓' : status === 'fail' ? '✕' : '○'}</span>
              <span>{suite.path.split('/').pop()} · {suite.cases.length} case{suite.cases.length === 1 ? '' : 's'}</span>
              <span className="sf-problem-where">{results.length ? `${passed}/${results.length} passing` : 'not run'}</span>
            </button>
          </li>;
        })}
      </ul>}
    <div className="sf-problems-empty"><button type="button" className="sf-btn-small" onClick={onOpenTests}>Open Tests</button></div>
  </div>;
}
