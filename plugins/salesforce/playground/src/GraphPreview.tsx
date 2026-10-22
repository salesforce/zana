import { useEffect, useMemo, useState } from 'react';
import { parseAgentScriptSource } from '../../lib/agent-script-parse.js';
import { coverageGaps, coverageStatus, readGraphCoverage, type CoverageCase, type GraphCoverage } from '../../lib/graph-coverage.js';
import { isHostToPlayground, PLAYGROUND_BRIDGE_SOURCE } from '../../src/app/playground-bridge.js';
import { AgentGraph } from './graph';

const OUTCOME_LABEL = { pass: 'Pass', fail: 'Fail', inconclusive: 'Unclear' } as const;

function Legend({ coverage }: { coverage: boolean }) {
  return <span className="graph-legend" aria-label="Legend">
    <span><svg width="22" height="6" aria-hidden="true"><line x1="0" y1="3" x2="22" y2="3" stroke="currentColor" strokeWidth="1.5" /></svg>always</span>
    <span><svg width="22" height="6" aria-hidden="true"><line x1="0" y1="3" x2="22" y2="3" stroke="currentColor" strokeWidth="1.5" strokeDasharray="5 4" /></svg>available</span>
    {coverage && <>
      <span><span className="as-node-status is-pass" aria-hidden="true">✓</span>passing</span>
      <span><span className="as-node-status is-fail" aria-hidden="true">!</span>failing</span>
      <span><span className="as-node-status is-none" aria-hidden="true">·</span>untested</span>
    </>}
  </span>;
}

function CaseList(props: { cases: CoverageCase[]; selected: string | null; gaps: string[]; onSelect(id: string | null): void }) {
  return <aside className="graph-cases" aria-label="Test cases">
    <h3>Cases <span className="hint">· click to trace</span></h3>
    {props.cases.map(row => <button key={row.id} type="button" className="graph-case" aria-pressed={props.selected === row.id} onClick={() => props.onSelect(props.selected === row.id ? null : row.id)}>
      <span className="graph-case-row"><span>{row.name}</span><span className={`graph-chip${row.outcome ? ` is-${row.outcome}` : ''}`}>{row.outcome ? OUTCOME_LABEL[row.outcome] : 'Not run'}</span></span>
      {row.outcome === 'fail' && row.reason && <span className="graph-case-why">✗ {row.reason}</span>}
    </button>)}
    <h3>Gaps <span className="hint">· no case reaches</span></h3>
    {props.gaps.length ? <div className="graph-gaps">{props.gaps.map(label => <code key={label}>{label}</code>)}</div> : <span className="hint">Every topic and action is reached.</span>}
    {props.gaps.length > 0 && <button type="button" className="graph-toggle" onClick={() => window.parent.postMessage({ source: PLAYGROUND_BRIDGE_SOURCE, type: 'draftCases', labels: props.gaps }, location.origin)}>+ Draft cases for gaps</button>}
  </aside>;
}

export function GraphPreview() {
  const [content, setContent] = useState('');
  const [theme, setTheme] = useState('dark');
  const [visible, setVisible] = useState(false);
  const [compact, setCompact] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);
  const [focusSeq, setFocusSeq] = useState(0);
  const [coverage, setCoverage] = useState<GraphCoverage | null>(null);
  const [showCoverage, setShowCoverage] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const graph = useMemo(() => parseAgentScriptSource(content, 'agentforce').graph, [content]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== window.parent || !isHostToPlayground(event.data) || event.data.type !== 'graph') return;
      const extra = event.data as { compact?: unknown; focus?: unknown; focusSeq?: unknown; coverage?: unknown; focusCase?: unknown };
      setContent(event.data.content); setTheme(event.data.theme); setVisible(event.data.visible);
      setCompact(extra.compact === true);
      setFocusSeq(typeof extra.focusSeq === 'number' ? extra.focusSeq : 0);
      setFocus(typeof extra.focus === 'string' && extra.focus.length <= 200 ? extra.focus : null);
      setCoverage(readGraphCoverage(extra.coverage));
      if (typeof extra.focusCase === 'string') { setSelected(extra.focusCase); setShowCoverage(true); }
    };
    window.addEventListener('message', receive);
    window.parent.postMessage({ source: PLAYGROUND_BRIDGE_SOURCE, type: 'ready' }, location.origin);
    return () => window.removeEventListener('message', receive);
  }, []);
  const labels = useMemo(() => graph.nodes.map(node => node.label), [graph.nodes]);
  const cases = coverage?.cases ?? [];
  const covered = showCoverage && cases.length > 0;
  const status = useMemo(() => covered && coverage ? coverageStatus(coverage, labels) : null, [covered, coverage, labels]);
  const gaps = useMemo(() => coverage ? coverageGaps(coverage, labels) : [], [coverage, labels]);
  const pinned = covered ? cases.find(row => row.id === selected) : undefined;
  const highlight = pinned ? { nodes: pinned.path, missing: pinned.missing } : null;
  return <div className={`ide graph-preview ${theme}${compact ? ' compact' : ''}`} data-testid="agent-script-graph">
    <header className="pane-header">
      <span>Conversation map<span className="pane-kicker">{graph.nodes.filter(node => node.kind === 'topic').length} topics · {graph.nodes.filter(node => node.kind === 'action').length} actions</span></span>
      <span>
        <Legend coverage={covered} />
        {cases.length > 0 && <button type="button" className="graph-toggle" aria-pressed={showCoverage} onClick={() => setShowCoverage(value => !value)}>Test coverage</button>}
      </span>
    </header>
    <div className={`pane-body graph-body${covered ? ' has-cases' : ''}`}>
      {covered && <CaseList cases={cases} selected={pinned?.id ?? null} gaps={gaps} onSelect={setSelected} />}
      <div className="graph-canvas">
        <AgentGraph nodes={graph.nodes} edges={graph.edges} visible={visible} compact={compact} focus={focus} focusSeq={focusSeq} status={status} highlight={highlight}
          onOpenAction={id => window.parent.postMessage({ source: PLAYGROUND_BRIDGE_SOURCE, type: 'openAction', id }, location.origin)} />
      </div>
    </div>
  </div>;
}
