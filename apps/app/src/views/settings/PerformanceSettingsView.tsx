import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Copy, RefreshCw } from 'lucide-react';
import type { RuntimePerformanceSnapshot } from '@zana-ai/zcc-desktop-contract';
import { useHosts } from '../../hooks/useHosts.js';
import { Section } from '../../components/settings/FormFields.js';
import { hasDesktopBridge } from '../../lib/app-surface.js';
import { copyText } from '../../lib/copy-text.js';
import { getThreadRoutePath } from '../../lib/route-paths.js';
import { useData } from '../../store.js';
import { formatDuration, formatMemory, performanceTrend, workloadTrend, THREAD_STATE_LABELS } from './performance-model.js';
import { usePerformance } from './use-performance.js';
import './performance.css';

/** Search target for the machine picker, which is not a FormFields row. */
const MACHINE_PICKER = { searchId: 'performance.machine' };

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="performance-metric"><dt>{label}</dt><dd>{value}</dd><p>{detail}</p></div>;
}

function Trend({ history, metric, label }: { history: RuntimePerformanceSnapshot[]; metric: 'cpuPercent' | 'memoryBytes'; label: string }) {
  const { segments, peak, count } = performanceTrend(history, metric);
  const peakLabel = peak == null ? 'Waiting for samples' : `Peak ${metric === 'cpuPercent' ? `${peak.toFixed(1)}%` : formatMemory(peak)}`;
  return <TrendChart segments={segments} count={count} label={label} peakLabel={peakLabel} />;
}

function TrendChart({ segments, count, label, peakLabel }: { segments: string[]; count: number; label: string; peakLabel: string }) {
  return <figure className="performance-trend">
    <figcaption><strong>{label}</strong><span>{peakLabel}</span></figcaption>
    {count < 2 ? <p className="performance-chart-empty">Collecting samples…</p> : <svg viewBox="0 0 400 100" role="img" aria-label={`${label} trend. ${peakLabel}. ${count} samples.`}>
      <path d="M4,94 L396,94" className="performance-chart-axis" />
      {segments.map((path, index) => <path key={index} d={path} className="performance-chart-line" vectorEffect="non-scaling-stroke" />)}
    </svg>}
  </figure>;
}

export function PerformanceSettingsView() {
  const hosts = useHosts();
  const projects = useData(s => s.projects);
  const [selectedId, setSelectedId] = useState('');
  const host = hosts.find(item => item.id === selectedId) ?? hosts.find(item => item.isPrimary) ?? hosts[0];
  const state = usePerformance(host?.id ?? null);
  const [copyStatus, setCopyStatus] = useState('');
  const daemon = state.resources?.processes.find(item => item.role === 'daemon');
  const server = state.resources?.processes.find(item => item.role === 'server');
  const summary = state.summary;
  const threadTrend = workloadTrend(state.workloadHistory);
  const connected = summary?.connected ?? host?.status === 'connected';
  const resourceStale = Boolean(state.resourceError || (state.resources && state.now - state.resources.sampledAt > 15_000));
  const summaryStale = Boolean(state.error || (summary && state.now - summary.sampledAt > 15_000));
  const cpu = (value: number | null | undefined) => value == null ? 'Warming up' : `${value.toFixed(1)}%`;
  const unavailable = hasDesktopBridge() ? 'Resource measurements are available for this desktop’s local runtime. Remote resource metrics are not available yet.' : 'Open the desktop app on this machine to see CPU and memory measurements.';
  const heartbeatAge = summary?.lastHeartbeatAt == null ? null : Math.max(0, summary.sampledAt - summary.lastHeartbeatAt);
  const copy = async () => {
    try {
      await copyText(JSON.stringify({ machine: host?.name, connection: summary, resources: state.resources, stale: resourceStale || summaryStale }, null, 2));
      setCopyStatus('Diagnostics copied');
    } catch { setCopyStatus('Could not copy diagnostics'); }
  };
  return <div className="performance-view" data-testid="performance-view">
    <div className="performance-toolbar" data-settings-target={MACHINE_PICKER.searchId}>
      <label>Machine<select aria-label="Performance machine" value={host?.id ?? ''} disabled={!hosts.length} onChange={event => { setSelectedId(event.target.value); setCopyStatus(''); }}>
        {!hosts.length && <option value="">No machines available</option>}
        {hosts.map(item => <option key={item.id} value={item.id}>{item.name}{item.isPrimary ? ' · primary' : ''}</option>)}
      </select></label>
      <button className="settings-btn" type="button" disabled={!host || state.refreshing} onClick={state.refresh}><RefreshCw size={14} />Refresh</button>
      <button className="settings-btn" type="button" disabled={!summary && !state.resources} onClick={() => void copy()}><Copy size={14} />Copy diagnostics</button>
    </div>
    <div className="performance-status" role="status">
      <span>{host ? summaryStale ? 'Connection data stale' : connected ? 'Connected' : 'Disconnected' : 'Waiting for machines'}</span>
      <span>{summary ? `Updated ${formatDuration(state.now - summary.sampledAt)} ago` : state.refreshing ? 'Loading performance…' : 'Waiting for data'}</span>
      {copyStatus && <span>{copyStatus}</span>}
    </div>
    {state.error && <p role="alert" className="settings-help">{state.error}</p>}
    {state.resourceError && <p role="alert" className="settings-help">{state.resourceError}</p>}
    {!state.resources && <p className="settings-help">{unavailable}</p>}
    {resourceStale && state.resources && <p className="settings-help">Resource measurements are stale.</p>}
    <dl className="performance-metrics">
      <Metric label="Daemon CPU" value={daemon ? cpu(daemon.cpuPercent) : 'Unavailable'} detail="100% = one logical CPU core" />
      <Metric label="Daemon memory" value={formatMemory(daemon?.memoryBytes)} detail="Physical working set; excludes child agents" />
      <Metric label="Process age" value={daemon && state.resources ? formatDuration(state.resources.sampledAt - daemon.createdAt) : 'Unavailable'} detail="Time since this daemon process started" />
      <Metric label="Threads in progress" value={summary ? `${summary.workload.activeThreads}${summary.workload.truncated ? '+' : ''}` : 'Unavailable'} detail={summaryStale || !connected ? 'Last known workload' : 'Starting, active, waiting or stopping; includes hidden threads'} />
    </dl>
    <Section title="Daemon trends" anchorId="performance-trends" searchId="performance.trends" help="Samples every five seconds while this page is visible. Up to ten minutes are kept for the selected machine; gaps break the line.">
      <div className="performance-charts"><Trend history={state.history} metric="cpuPercent" label="CPU" /><Trend history={state.history} metric="memoryBytes" label="Memory" /></div>
    </Section>
    <Section title="Current work" anchorId="performance-work">
      <dl className="performance-facts">
        {Object.entries(THREAD_STATE_LABELS).map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{summary ? `${summary.workload.threadStates[key as keyof typeof THREAD_STATE_LABELS]}${summary.workload.truncated ? '+' : ''}` : 'Unavailable'}</dd></div>)}
        <div><dt>Open terminals</dt><dd>{summary ? String(summary.workload.terminals) : 'Unavailable'}</dd></div>
      </dl>
      {(!connected || summaryStale) && <p className="settings-help">Last known counts; work may have stopped or changed.</p>}
      <p className="settings-help">Waiting threads are counted separately from active threads. Hidden threads are included; idle saved conversations are excluded.</p>
      {summary?.workload.truncated && <p className="settings-help">Counts are lower bounds: this sample covers the first 1,000 threads in progress.</p>}
      <TrendChart segments={threadTrend.segments} count={threadTrend.count} label="Thread load" peakLabel={threadTrend.peak === null ? 'Waiting for connected samples' : `Observed peak ${threadTrend.peak}${threadTrend.truncated ? '+' : ''}`} />
      <p className="settings-help">Total threads in progress over up to ten minutes on this page. Disconnections and sampling gaps break the line.</p>
      {summary && (summary.threads.length ? <>
        <ul className="performance-threads" aria-label="Threads in progress">
          {summary.threads.map(thread => {
            const project = projects.find(item => item.id === thread.projectId);
            return <li key={thread.id}><Link to={getThreadRoutePath(thread.id, project?.id)}>
              <span className="performance-thread-heading"><strong>{thread.title || 'Untitled thread'}</strong><span className="performance-thread-state">{THREAD_STATE_LABELS[thread.state]}</span></span>
              <span className="performance-thread-context">{project?.name ?? 'Unregistered project'} · Provider: {thread.providerId}{thread.visibility === 'hidden' && <span className="performance-thread-hidden">Hidden</span>}</span>
            </Link></li>;
          })}
        </ul>
        <p className="settings-help">Showing {summary.threads.length} of {summary.workload.activeThreads}{summary.workload.truncated ? '+' : ''} threads. Waiting threads appear first.</p>
      </> : <p className="settings-help">{connected && !summaryStale ? 'No threads in progress.' : 'No threads in the last sample.'}</p>)}
    </Section>
    <Section title="Product server" anchorId="performance-server" searchId="performance.server" help="The server handles application data and history. Its resource use is measured separately from the execution daemon.">
      <dl className="performance-facts"><div><dt>CPU</dt><dd>{server ? cpu(server.cpuPercent) : 'Unavailable'}</dd></div><div><dt>Memory</dt><dd>{formatMemory(server?.memoryBytes)}</dd></div><div><dt>Process age</dt><dd>{server && state.resources ? formatDuration(state.resources.sampledAt - server.createdAt) : 'Unavailable'}</dd></div></dl>
    </Section>
    <Section title="Connection & diagnostics" anchorId="performance-connection">
      <dl className="performance-facts">
        <div><dt>Connected for</dt><dd>{summary?.connectedAt && connected ? formatDuration(summary.sampledAt - summary.connectedAt) : '—'}</dd></div>
        <div><dt>Last heartbeat</dt><dd>{!connected ? 'Disconnected' : heartbeatAge == null ? 'Waiting for heartbeat' : `${formatDuration(heartbeatAge)} ago${heartbeatAge > 45_000 ? ' · overdue' : ''}`}</dd></div>
      </dl>
      <p className="settings-help">Heartbeats arrive about every 15 seconds. Connection duration resets on reconnect; process age does not.</p>
      <details><summary>Recent connections</summary>
        {summary?.recentConnections.length ? <ul className="performance-connections">{summary.recentConnections.map((connection, index) => <li key={index}>
          <time dateTime={new Date(connection.startedAt).toISOString()}>{new Date(connection.startedAt).toLocaleString()}</time>
          <span>{connection.closedAt ? `Closed ${new Date(connection.closedAt).toLocaleString()} · ${connection.reason === 'socket-closed' ? 'Connection closed' : connection.reason === 'connection-replaced' || connection.reason === 'replaced' ? 'Connection replaced' : 'Ended'}` : connected && index === 0 ? 'Current connection' : 'End time not recorded'}</span>
        </li>)}</ul> : <p className="settings-help">No connection history available.</p>}
      </details>
      <Link className="settings-btn performance-machines-link" to="/settings/machines">Open Machines</Link>
    </Section>
  </div>;
}
