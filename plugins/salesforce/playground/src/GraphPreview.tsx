import { useEffect, useMemo, useState } from 'react';
import { parseAgentScriptSource } from '../../lib/agent-script-parse.js';
import { isHostToPlayground, PLAYGROUND_BRIDGE_SOURCE } from '../../src/app/playground-bridge.js';
import { AgentGraph } from './graph';

export function GraphPreview() {
  const [content, setContent] = useState('');
  const [theme, setTheme] = useState('dark');
  const [visible, setVisible] = useState(false);
  const graph = useMemo(() => parseAgentScriptSource(content, 'agentforce').graph, [content]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== window.parent || !isHostToPlayground(event.data) || event.data.type !== 'graph') return;
      setContent(event.data.content); setTheme(event.data.theme); setVisible(event.data.visible);
    };
    window.addEventListener('message', receive);
    window.parent.postMessage({ source: PLAYGROUND_BRIDGE_SOURCE, type: 'ready' }, location.origin);
    return () => window.removeEventListener('message', receive);
  }, []);
  return <div className={`ide graph-preview ${theme}`} data-testid="agent-script-graph">
    <header className="pane-header"><span>Conversation map</span><span className="pane-kicker">{graph.nodes.filter(node => node.kind === 'topic').length} topics · {graph.nodes.filter(node => node.kind === 'action').length} actions</span></header>
    <div className="pane-body"><AgentGraph nodes={graph.nodes} edges={graph.edges} visible={visible} onOpenAction={id => window.parent.postMessage({ source: PLAYGROUND_BRIDGE_SOURCE, type: 'openAction', id }, location.origin)} /></div>
  </div>;
}
