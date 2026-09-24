import { useSalesforceControl, controlText } from '../useSalesforceControl.js';
import { useMemo, useRef, useState } from 'react';
import type { SalesforcePanelProps } from './WorkbenchPanels.js';
import { useSalesforceCall } from '../components/client.js';
import { useResource } from '../components/use-resource.js';
import { EmptyState, ErrorState, LoadingState } from '../components/ui.js';
import { displayTime } from './workbench-presentation.js';

export function DebugLogsPanel(props: SalesforcePanelProps) {
  const call = useSalesforceCall(props.pluginId, props, props.threadId);
  const [logId, setLogId] = useState(props.logId ?? '');
  const [search, setSearch] = useState('');
  const [find, setFind] = useState('');
  const [match, setMatch] = useState(0);
  const code = useRef<HTMLPreElement>(null);
  const logs = useResource<{ data?: { records?: Record<string, unknown>[] } }>(call, 'apex.logs');
  const log = useResource<{ body: string; truncated?: boolean }>(call, logId ? 'logs.get' : null, { logId });
  useSalesforceControl({ pluginId: props.pluginId, projectId: props.projectId, orgAlias: props.orgAlias, threadId: props.threadId, surface: 'logs',
    commands: ['state', 'log.open', 'filter.set'], state: () => ({ logId, filter: search, find, busy: log.busy, error: log.error }),
    execute: ({ command, input }) => {
      if (command === 'log.open') { const id = controlText(input, 'logId', 18); if (!/^[A-Za-z0-9]{15,18}$/.test(id)) throw Error('Choose a valid log ID.'); setLogId(id); setMatch(0); }
      if (command === 'filter.set') { if (input.target === 'body') { setFind(controlText(input, 'query', 200)); setMatch(0); } else setSearch(controlText(input, 'query', 200)); }
    },
  });
  const records = logs.data?.data?.records ?? [];
  const visible = records.filter(row => `${row.Operation} ${row.Status} ${row.StartTime}`.toLowerCase().includes(search.toLowerCase()));
  const selected = records.find(row => row.Id === logId);
  const parts = useMemo(() => {
    const body = log.data?.body ?? '';
    if (!find) return [body];
    const escaped = find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return body.split(new RegExp(`(${escaped})`, 'gi'));
  }, [log.data?.body, find]);
  const matches = Math.floor(parts.length / 2);
  function nextMatch() {
    if (!matches) return;
    const next = match % matches;
    code.current?.querySelectorAll('mark')[next]?.scrollIntoView({ block: 'center' });
    setMatch(next + 1);
  }
  return <div className="sf-logs-workspace">
    <aside className="sf-log-list-pane">
      <div className="sf-workspace-heading"><div><span className="sf-eyebrow">Apex</span><h2>Debug logs</h2></div><button type="button" className="sf-btn quiet" disabled={logs.busy} onClick={() => void logs.refresh()}>{logs.busy ? 'Refreshing…' : 'Refresh logs'}</button></div>
      <div className="sf-activity-tools"><input className="sf-input" aria-label="Search debug logs" placeholder="Filter by operation or status…" value={search} onChange={event => setSearch(event.target.value)} /></div>
      {logs.error && <ErrorState message={logs.error} retry={() => void logs.refresh()} />}
      {logs.busy && !logs.data && <LoadingState compact art="logs" label="Loading debug logs…" />}
      <div className="sf-log-list" role="group" aria-label="Debug log list">
        {visible.map(row => <button className="sf-activity-item" type="button" key={String(row.Id)} aria-pressed={logId === row.Id} onClick={() => { setLogId(String(row.Id)); setMatch(0); }}>
          <span className="sf-item-top"><strong>{String(row.Operation || 'Apex execution')}</strong><span className={`sf-badge ${String(row.Status).toLowerCase().includes('success') ? 'sf-success' : 'sf-error'}`}>{String(row.Status ?? '')}</span></span>
          <span className="sf-item-meta">{displayTime(String(row.StartTime ?? ''))}{typeof row.LogLength === 'number' && <span>{Math.ceil(row.LogLength / 1024)} KB</span>}</span>
        </button>)}
        {logs.data && !visible.length && <EmptyState compact art={search ? "search" : "logs"} title={records.length ? 'No matching logs' : 'No debug logs returned'}>{records.length ? 'Try another operation or status.' : 'Generate a log in the org and refresh.'}</EmptyState>}
      </div>
    </aside>
    <section className="sf-log-reader" aria-label="Log details">
      <div className="sf-workspace-heading"><div><span className="sf-eyebrow">Log details</span><h2>{selected ? String(selected.Operation || 'Apex execution') : logId || 'Inspect an execution'}</h2></div></div>
      {log.error && <ErrorState message={log.error} retry={() => void log.refresh()} />}
      {log.busy && <LoadingState art="logs" label="Opening log…" />}
      {log.data ? <>
        <div className="sf-log-find"><input className="sf-input" aria-label="Find in log" placeholder="Find text in this log…" value={find} onChange={event => { setFind(event.target.value); setMatch(0); }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); nextMatch(); } }} /><span className="sf-muted sf-small" role="status">{find ? `${matches} ${matches === 1 ? 'match' : 'matches'}` : ''}</span><button className="sf-btn" disabled={!matches} type="button" onClick={nextMatch}>Next match</button></div>
        <pre className="sf-code sf-log-code" ref={code}>{parts.map((part, index) => index % 2 ? <mark key={index} data-current={index === match * 2 - 1}>{part}</mark> : part)}</pre>
        <div className="sf-log-footer">{log.data.truncated && <p className="sf-muted sf-small">Showing the first 64,000 characters.</p>}{props.onAddToPrompt && <button className="sf-btn" type="button" onClick={() => props.onAddToPrompt?.(`Apex log ${logId}\n${log.data!.body.slice(0, 8000)}`)}>Add log excerpt to prompt</button>}</div>
      </> : !log.busy && !log.error && <EmptyState art="logs" title="Select a log">Choose an execution to inspect its output and find errors.</EmptyState>}
    </section>
  </div>;
}
