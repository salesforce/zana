import { useEffect, useRef, useState } from 'react';
import { isPlaygroundToHost, PLAYGROUND_ASSET_SRC, PLAYGROUND_BRIDGE_SOURCE, readDocumentTheme } from './playground-bridge.js';
import { PLAYGROUND_READY_MS } from './agent-script-panel-logic.js';
import { LoadingState, SalesforceState } from './components/SalesforceState.js';

/** Graph has its own view, but never owns or writes the editor's draft. */
export function AgentScriptGraphPanel({ source, visible, onOpenAction }: { source: string; visible: boolean; onOpenAction: (id: string) => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
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
  }, [onOpenAction]);
  useEffect(() => {
    if (ready) return;
    const timer = window.setTimeout(() => setFailed(true), PLAYGROUND_READY_MS);
    return () => window.clearTimeout(timer);
  }, [ready]);
  useEffect(() => {
    if (!ready) return;
    const send = () => frame.current?.contentWindow?.postMessage({ source: PLAYGROUND_BRIDGE_SOURCE, type: 'graph', content: source, visible, theme: readDocumentTheme() }, location.origin);
    send();
    const observer = new MutationObserver(send);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, [source, visible, ready]);
  return <div className="sf-frame-stage" style={{ position: 'relative', display: 'flex', flex: 1, minHeight: 0 }}>
    {failed ? <SalesforceState compact kind="error" art="code" title="Could not load the graph">Close this tab and reopen Graph view to retry.</SalesforceState> : !ready && <LoadingState compact art="code" label="Opening graph view…" />}
    <iframe ref={frame} title="AgentScript graph" src={typeof process !== 'undefined' && process.env.VITEST ? 'about:blank' : `${PLAYGROUND_ASSET_SRC}?graph`} hidden={failed} className="af-tool-frame" />
  </div>;
}
