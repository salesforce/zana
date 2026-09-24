import { useSalesforceControl, controlText } from '../useSalesforceControl.js';
import { useEffect, useState } from 'react';
import type { SalesforceOperation } from '../../../lib/workbench-contract.js';
import type { SalesforcePanelProps } from './WorkbenchPanels.js';
import { useSalesforceCall, requireResult } from '../components/client.js';
import { useResource } from '../components/use-resource.js';
import { EmptyState, ErrorState, LoadingState, RunSummary } from '../components/ui.js';
import { OPERATION_LABELS, displayTime } from './workbench-presentation.js';

export function OperationsPanel(props: SalesforcePanelProps & { revision?: number; scope?: 'apex' | 'deployments' }) {
  const call = useSalesforceCall(props.pluginId, props, props.threadId);
  const state = useResource<{ operations: SalesforceOperation[] }>(call, 'operations.list');
  const [selected, setSelected] = useState(props.operationId ?? '');
  const [error, setError] = useState<string | null>(null);
  const [reportBusy, setReportBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [all, setAll] = useState(Boolean(props.operationId));
  useEffect(() => {
    if (props.revision) { setSelected(''); setSearch(''); }
    void state.refresh();
  }, [props.revision, state.refresh]);
  useSalesforceControl({ pluginId: props.pluginId, projectId: props.projectId, orgAlias: props.orgAlias, threadId: props.threadId, surface: 'operations',
    commands: ['state', 'operation.open', 'filter.set'], state: () => ({ operationId: selected, filter: search, scope: props.scope, error: state.error }),
    execute: async ({ command, input }) => {
      if (command === 'operation.open') {
        const id = controlText(input, 'operationId', 80);
        const data = requireResult<{ operations: SalesforceOperation[] }>(await call('operations.list'));
        if (!data.operations.some(row => row.id === id)) throw Error('Operation not found in this project.');
        await state.refresh(); setSelected(id); setAll(true); setSearch('');
      }
      if (command === 'filter.set') setSearch(controlText(input, 'query', 200));
    },
  });
  const running = state.data?.operations.some(row => row.state === 'running');
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => void state.refresh(), 2000);
    return () => clearInterval(timer);
  }, [running, state.refresh]);
  const operations = (state.data?.operations ?? []).filter(row => {
    const inScope = !props.scope || all || (props.scope === 'apex' ? /^(apex|lwc)\./ : /^(deploy|retrieve)\./).test(row.kind);
    return inScope && `${OPERATION_LABELS[row.kind]} ${row.title} ${row.org.alias} ${row.state}`.toLowerCase().includes(search.toLowerCase());
  });
  const operation = operations.find(row => row.id === selected) ?? operations[0];
  async function refreshReport() {
    if (!operation || reportBusy) return;
    setError(null); setReportBusy(true);
    try { requireResult(await call('operations.report', { operationId: operation.id })); await state.refresh(); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setReportBusy(false); }
  }
  return <section className="sf-activity" data-testid="salesforce-operations" aria-label="Operation history">
    <div className="sf-workspace-heading">
      <div><span className="sf-eyebrow">Activity</span><h2>Results & history</h2></div>
      <button className="sf-btn quiet" type="button" disabled={state.busy} onClick={() => void state.refresh()}>Refresh</button>
    </div>
    {(state.error || error) && <ErrorState message={state.error || error!} retry={() => {
      if (error && !state.error) void refreshReport();
      else { setError(null); void state.refresh(); }
    }} />}
    <div className="sf-activity-tools">
      <input className="sf-input" aria-label="Search operations" placeholder="Search activity…" value={search} onChange={event => setSearch(event.target.value)} />
      {props.scope && <button className="sf-btn quiet" type="button" aria-label={all ? 'Show relevant activity' : 'Show all activity'} aria-pressed={all} onClick={() => setAll(value => !value)}>{all ? 'All activity' : props.scope === 'apex' ? 'Apex & LWC only' : 'Deployments only'}</button>}
    </div>
    {state.busy && !state.data && <LoadingState compact art="deploy" label="Loading activity…" />}
    {operations.length ? <div className="sf-activity-body">
      <div className="sf-activity-list" role="group" aria-label="Recent operations">
        {operations.map(row => <button className="sf-activity-item" type="button" key={row.id} aria-pressed={operation?.id === row.id} onClick={() => { setSelected(row.id); setError(null); }}>
          <span className="sf-item-top"><strong>{OPERATION_LABELS[row.kind]}</strong><span className="sf-item-state"><i className="sf-status-dot" data-state={row.state} aria-hidden="true" />{row.state}</span></span>
          <span className="sf-item-title">{row.title}</span>
          <span className="sf-item-meta"><span>{row.org.alias}</span><time dateTime={new Date(row.at).toISOString()}>{displayTime(row.at)}</time></span>
        </button>)}
      </div>
      <div className="sf-activity-detail" aria-busy={reportBusy}>
        {operation && <RunSummary operation={operation} onAddToPrompt={props.onAddToPrompt} onRefresh={operation.jobId ? () => void refreshReport() : undefined} refreshBusy={reportBusy} />}
      </div>
    </div> : !state.busy && !state.error && <EmptyState compact art={search ? "search" : "deploy"} title={search ? 'No matching activity' : 'No operations yet'}>
      {search ? 'Try a component name, org, or status.' : 'Your results will appear here after a preview, validation, or test run.'}
    </EmptyState>}
  </section>;
}
