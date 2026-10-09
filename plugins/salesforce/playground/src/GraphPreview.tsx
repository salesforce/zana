import { useEffect, useMemo, useState } from 'react';
import { parseAgentScriptSource } from '../../lib/agent-script-parse.js';
import { isHostToPlayground, PLAYGROUND_BRIDGE_SOURCE } from '../../src/app/playground-bridge.js';
import { AgentGraph } from './graph';

export function GraphPreview() {
  const [content, setContent] = useState('');
  const [theme, setTheme] = useState('dark');
  const [visible, setVisible] = useState(false);
  const [compact, setCompact] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);
  const [focusSeq, setFocusSeq] = useState(0);
  const graph = useMemo(() => parseAgentScriptSource(content, 'agentforce').graph, [content]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== window.parent || !isHostToPlayground(event.data) || event.data.type !== 'graph') return;
      const extra = event.data as { compact?: unknown; focus?: unknown; focusSeq?: unknown };
      setContent(event.data.content); setTheme(event.data.theme); setVisible(event.data.visible);
      setCompact(extra.compact === true);
      setFocusSeq(typeof extra.focusSeq === 'number' ? extra.focusSeq : 0);
      setFocus(typeof extra.focus === 'string' && extra.focus.length <= 200 ? extra.focus : null);
    };
    window.addEventListener('message', receive);
    window.parent.postMessage({ source: PLAYGROUND_BRIDGE_SOURCE, type: 'ready' }, location.origin);
    return () => window.removeEventListener('message', receive);
  }, []);
  return <div className={`ide graph-preview ${theme}${compact ? ' compact' : ''}`} data-testid="agent-script-graph">
    <header className="pane-header"><span>Conversation map</span><span className="pane-kicker">{graph.nodes.filter(node => node.kind === 'topic').length} topics · {graph.nodes.filter(node => node.kind === 'action').length} actions</span></header>
    <div className="pane-body"><AgentGraph nodes={graph.nodes} edges={graph.edges} visible={visible} compact={compact} focus={focus} focusSeq={focusSeq} onOpenAction={id => window.parent.postMessage({ source: PLAYGROUND_BRIDGE_SOURCE, type: 'openAction', id }, location.origin)} /></div>
  </div>;
}
