import { useEffect, useRef, useState } from 'react';
import { isPlaygroundToHost, PLAYGROUND_ASSET_SRC, PLAYGROUND_BRIDGE_SOURCE, readDocumentTheme } from './playground-bridge.js';
import { PLAYGROUND_READY_MS } from './agent-script-panel-logic.js';
import { LoadingState, SalesforceState } from './components/SalesforceState.js';

/** Graph has its own view, but never owns or writes the editor's draft. */
export interface AgentScriptGraphPanelProps {
  source: string;
  visible: boolean;
  onOpenAction: (id: string) => void;
  /** Vertical single-column layout for narrow containers. */
  compact?: boolean;
  /** `graph.focus {node}`: node id or label to centre and highlight. Bump `focusSeq` to re-focus the same node. */
  focusNode?: string | null;
  focusSeq?: number;
}

export function AgentScriptGraphPanel({ source, visible, onOpenAction, compact = false, focusNode = null, focusSeq = 0 }: AgentScriptGraphPanelProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const retry = () => { setReady(false); setFailed(false); setAttempt(value => value + 1); };
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== frame.current?.contentWindow || !isPlaygroundToHost(event.data)) return;
      if (event.data.type === 'ready') { setReady(true); setFailed(false); }
      if (event.data.type === 'openAction') onOpenAction(event.data.id);
    };
    const element = frame.current;
    const fail = () => setFailed(true);
    element?.addEventListener('error', fail);
    window.addEventListener('message', receive);
    return () => { window.removeEventListener('message', receive); element?.removeEventListener('error', fail); };
  }, [onOpenAction, attempt]);
  useEffect(() => {
    if (ready) return;
    const timer = window.setTimeout(() => setFailed(true), PLAYGROUND_READY_MS);
    return () => window.clearTimeout(timer);
  }, [ready, attempt]);
  useEffect(() => {
    if (!ready) return;
    const send = () => frame.current?.contentWindow?.postMessage({ source: PLAYGROUND_BRIDGE_SOURCE, type: 'graph', content: source, visible, theme: readDocumentTheme(), compact, focus: focusNode ?? undefined, focusSeq }, location.origin);
    send();
    const observer = new MutationObserver(send);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, [source, visible, ready, compact, focusNode, focusSeq]);
  return <div className="sf-frame-stage" style={{ position: 'relative', display: 'flex', flex: 1, minHeight: 0 }}>
    {failed ? <SalesforceState compact kind="error" art="code" title="Could not load the graph" action={<button type="button" className="sf-btn" onClick={retry}>Retry</button>}>The graph view did not respond.</SalesforceState> : !ready && <LoadingState compact art="code" label="Opening graph view…" />}
    <iframe key={attempt} ref={frame} title="AgentScript graph" src={typeof process !== 'undefined' && process.env.VITEST ? 'about:blank' : `${PLAYGROUND_ASSET_SRC}?graph`} hidden={failed} className="af-tool-frame" />
  </div>;
}
