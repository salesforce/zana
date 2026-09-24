import { useSalesforceControl, controlText } from '../useSalesforceControl.js';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { EXPLORER_LOAD_ALL_CAP } from '../../../lib/types.js';
import type { PublicOrgView } from '../../../lib/types.js';
import type { SObjectListEntry, SoqlDescribeCatalogs, SoqlSObjectDescribe } from '../../../lib/soql-describe.js';
import type { SoqlHistoryItem } from '../../../lib/soql-history.js';
import { mergeQueryPage, truncateToCap, type QueryPage } from '../../../lib/soql-query-more.js';
import { copyText, downloadText, recordsToCsv, recordsToJson, recordsToTsv } from './soql-export.js';
import { DEFAULT_SOQL } from './soql-examples.js';
import { flattenRecords, discoverColumns } from './soql-flatten.js';
import {
  canRun,
  confirmExport,
  confirmLoadAll,
  emptyOrgMessage,
  newRequestId,
  orgChip,
  productionBanner
} from './soql-explorer-logic.js';
import { seedQueryForSObject, toggleChildField, toggleField } from './soql-field-selection.js';
import { SoqlEditor, type SoqlEditorHandle } from './SoqlEditor.js';
import { SoqlHistoryDrawer } from './SoqlHistoryDrawer.js';
import { SoqlResultsGrid } from './SoqlResultsGrid.js';
import { SoqlSchemaRail } from './SoqlSchemaRail.js';
import { useSalesforceCall, requireResult } from '../components/client.js';
import { SALESFORCE_STYLES } from '../components/styles.js';
import { RecordInspector, OrgBadge } from '../components/ui.js';
import { ActionDialog } from '../components/ActionDialog.js';
import { useSalesforceDraft } from '../components/drafts.js';
import { OrgPicker } from '../OrgPicker.js';
import { QueryEditorPane } from './QueryEditorPane.js';

const PLUGIN_ID = 'salesforce';
const PANEL_ROOT: CSSProperties = { height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' };
export const SOQL_HOST_STYLES = `
.sf-soql { --sf-soql-surface: var(--bg-panel); --sf-soql-elevated: var(--bg-elevated); --sf-soql-sunken: var(--bg-base); --sf-soql-border: var(--border); --sf-soql-text: var(--text-primary); --sf-soql-muted: var(--text-muted); --sf-soql-accent: var(--accent); height: 100%; min-height: 0; display: flex; flex-direction: column; color: var(--sf-soql-text); background: var(--sf-soql-surface); }
.sf-soql-header { display: flex; align-items: center; gap: 8px; min-height: 48px; flex-wrap: wrap; padding: 10px 12px; flex-shrink: 0; background: var(--sf-soql-elevated); border-bottom: 1px solid var(--sf-soql-border); }
.sf-soql-brand { font-size: 13px; font-weight: 600; }
.sf-soql-chip { font-size: 12px; color: var(--sf-soql-muted); }
.sf-org-picker { font: inherit; font-size: 12px; color: var(--sf-soql-text); background: var(--sf-soql-sunken); border: 1px solid var(--sf-soql-border); border-radius: 6px; height: 28px; max-width: 280px; }
.sf-soql-spacer { flex: 1; }
.sf-soql-btn { height: 28px; padding: 0 10px; border-radius: 6px; border: 1px solid var(--sf-soql-border); background: transparent; color: var(--sf-soql-text); font-size: 12px; cursor: pointer; }
.sf-soql-btn.primary { background: var(--sf-soql-accent); border-color: transparent; color: var(--text-on-accent,#fff); font-weight: 600; }
.sf-soql-btn:disabled { opacity: .45; cursor: default; }
.sf-soql-toggle { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--sf-soql-muted); }
.sf-soql-banner { padding: 6px 12px; font-size: 12px; border-bottom: 1px solid var(--sf-soql-border); color: var(--sf-soql-muted); }
.sf-soql-banner.is-warn { color: var(--accent-gold); }
.sf-soql-banner.is-error { color: var(--danger, #ff8a8a); }
.sf-soql-body { display: flex; flex: 1; min-height: 0; }
.sf-soql-rail { width: 280px; flex-shrink: 0; display: flex; flex-direction: column; background: var(--sf-soql-sunken); border-right: 1px solid var(--sf-soql-border); }
.sf-soql-rail.is-collapsed { width: 36px; }
.sf-soql-rail-head { display: flex; align-items: center; gap: 6px; padding: 8px; }
.sf-soql-rail-title { font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--sf-soql-muted); flex: 1; }
.sf-soql-rail-toggle { border: 0; background: transparent; color: var(--sf-soql-muted); cursor: pointer; width: 22px; height: 22px; }
.sf-soql-search { margin: 0 8px 8px; font: inherit; font-size: 12px; padding: 6px 8px; border-radius: 6px; border: 1px solid var(--sf-soql-border); background: var(--sf-soql-elevated); color: var(--sf-soql-text); }
.sf-soql-rail-scroll { flex: 1; min-height: 0; overflow: auto; padding: 0 6px 10px; }
.sf-soql-section-label { font-size: 10px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--sf-soql-muted); padding: 8px 6px 4px; }
.sf-soql-tree-btn { display: flex; align-items: center; gap: 6px; width: 100%; text-align: left; border: 0; border-radius: 6px; padding: 4px 6px; font-size: 12px; color: var(--sf-soql-text); background: transparent; cursor: pointer; }
.sf-soql-tree-btn:hover, .sf-soql-tree-btn.is-active { background: color-mix(in srgb, var(--sf-soql-accent) 18%, transparent); }
.sf-soql-tree-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sf-soql-tree-meta { margin-left: auto; font-size: 10px; color: var(--sf-soql-muted); }
.sf-soql-field-row { display: flex; align-items: center; gap: 6px; padding: 2px 6px; font-size: 12px; }
.sf-soql-field-row label { display: flex; align-items: center; gap: 6px; flex: 1; min-width: 0; }
.sf-soql-link { border: 0; background: transparent; color: var(--sf-soql-muted); font-size: 11px; cursor: pointer; }
.sf-soql-stage { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
.sf-soql-split { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.sf-soql-editor { flex: 1; min-height: 0; display: flex; flex-direction: column; border-bottom: 1px solid var(--sf-soql-border); position: relative; }
.sf-soql-textarea { flex: 1; min-height: 0; resize: none; border: 0; padding: 12px; font: 13px/1.45 ui-monospace, SFMono-Regular, Menlo, Monaco, monospace; background: var(--sf-soql-surface); color: var(--sf-soql-text); }
.sf-soql-editor-meta { display: flex; flex-wrap:wrap; align-items: center; gap: 8px; padding: 6px 10px; border-top: 1px solid var(--sf-soql-border); }
.sf-soql-hint { font-size: 11px; color: var(--sf-soql-muted); }
.sf-soql-editor-error { margin: 0; padding: 6px 10px; font-size: 12px; color: var(--danger, #ff8a8a); }
.sf-soql-completions { position: absolute; left: 12px; bottom: 42px; max-height: 180px; overflow: auto; margin: 0; padding: 4px; list-style: none; background: var(--sf-soql-elevated); border: 1px solid var(--sf-soql-border); border-radius: 8px; min-width: 240px; z-index: 2; }
.sf-soql-completions button { display: flex; width: 100%; gap: 8px; border: 0; background: transparent; color: inherit; font: inherit; font-size: 12px; padding: 4px 6px; cursor: pointer; }
.sf-soql-muted { color: var(--sf-soql-muted); margin-left: auto; }
.sf-soql-results { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.sf-soql-results-meta { display: flex; align-items: center; gap: 8px; padding: 6px 10px; font-size: 12px; color: var(--sf-soql-muted); }
.sf-soql-results-pager { margin-left: auto; display: flex; gap: 6px; }
.sf-soql-table-wrap { flex: 1; min-height: 0; overflow: auto; }
.sf-soql-table { border-collapse: collapse; width: max-content; min-width: 100%; font-size: 12px; }
.sf-soql-table th, .sf-soql-table td { border-bottom: 1px solid var(--sf-soql-border); padding: 6px 8px; text-align: left; white-space: nowrap; }
.sf-soql-table th { position: sticky; top: 0; background: var(--sf-soql-elevated); }
.sf-soql-empty { padding: 16px; font-size: 12px; color: var(--sf-soql-muted); }
.sf-soql-history { width: 260px; flex-shrink: 0; border-left: 1px solid var(--sf-soql-border); background: var(--sf-soql-sunken); overflow: auto; }
.sf-soql-history-row { display: flex; align-items: center; }
.sf-soql-search-table { height: 28px; width: 160px; font: inherit; font-size: 12px; padding: 0 8px; border-radius: 6px; border: 1px solid var(--sf-soql-border); background: var(--sf-soql-sunken); color: var(--sf-soql-text); }
`;

type QueryState = QueryPage & { soql?: string; sobjectName?: string; useToolingApi?: boolean; includeDeleted?: boolean };

type RpcFail = { ok: false; code?: string; error?: string; line?: number; column?: number };

export function SoqlExplorerPanel(props: { pluginId: string; projectId?: string; orgAlias?: string; threadId?: string; initialQuery?: string; draftId?: string; onAddToPrompt?(text: string): void; onOpenRecord?(recordId: string, objectName: string, orgAlias: string): void }) {
  const pluginId = props.pluginId || PLUGIN_ID;
  const call = useSalesforceCall(pluginId, { projectId: props.projectId, orgAlias: props.orgAlias }, props.threadId);
  const epoch = useRef(0);
  const describeEpoch = useRef(0);
  const draftKey = `${props.projectId ?? 'global'}:${props.draftId ?? props.threadId ?? 'data'}`;
  const editorRef = useRef<SoqlEditorHandle>(null);
  const requestIdRef = useRef<string | null>(null);
  const [org, setOrg] = useState<PublicOrgView | null>(null);
  const [orgError, setOrgError] = useState<string | null>(null);
  const [catalogs, setCatalogs] = useState<SoqlDescribeCatalogs>({ standard: [], tooling: [] });
  const [soql, setSoql] = useSalesforceDraft(draftKey, props.initialQuery ?? DEFAULT_SOQL);
  const [useToolingApi, setUseToolingApi] = useState(false);
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [selected, setSelected] = useState<string | undefined>();
  const [describe, setDescribe] = useState<SoqlSObjectDescribe | null>(null);
  const [schemaSearch, setSchemaSearch] = useState('');
  const [tableSearch, setTableSearch] = useState('');
  const [railCollapsed, setRailCollapsed] = useState(Boolean(props.threadId));
  const [historyOpen, setHistoryOpen] = useState(false);
  const [recent, setRecent] = useState<SoqlHistoryItem[]>([]);
  const [saved, setSaved] = useState<SoqlHistoryItem[]>([]);
  const [result, setResult] = useState<QueryState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; line?: number; column?: number } | null>(null);
  const [apiUsage, setApiUsage] = useState<string | null>(null);
  const [accessoryErrors, setAccessoryErrors] = useState<string[]>([]);
  const [inspected, setInspected] = useState<Record<string, unknown> | null>(null);
  const [dialog, setDialog] = useState<{ title: string; message?: string; input?: string; confirm(value: string): void } | null>(null);
  const [explain, setExplain] = useState<string | null>(null);



  const hasOrg = Boolean(org);
  const banner = productionBanner(org);
  const runEnabled = canRun(soql, hasOrg, busy);

  const loadAccessories = useCallback(async (alias: string, generation: number) => {
    const results = await Promise.allSettled([
      call('soql.limits', { orgAlias: alias }).then(requireResult<{ dailyApiRequests?: { max: number; remaining: number } | null }>),
      call('soql.history.list', { orgAlias: alias }).then(requireResult<{ recent: SoqlHistoryItem[]; saved: SoqlHistoryItem[] }>),
    ]);
    if (generation !== epoch.current) return;
    const [limits, history] = results;
    const errors: string[] = [];
    if (limits.status === 'fulfilled') {
      const usage = limits.value.dailyApiRequests;
      setApiUsage(usage ? `${usage.remaining}/${usage.max}` : null);
    } else errors.push('API usage');
    if (history.status === 'fulfilled') { setRecent(history.value.recent); setSaved(history.value.saved); }
    else errors.push('Query history');
    setAccessoryErrors(errors);
  }, [call]);

  const loadOrgAndSchema = useCallback(
    async (forceRefresh = false) => {
      const generation = ++epoch.current;
      setOrgError(null); setAccessoryErrors([]); setError(null); setOrg(null); setRecent([]); setSaved([]); setCatalogs({ standard: [], tooling: [] }); setApiUsage(null); setExplain(null); setDialog(null); setResult(null); setInspected(null); setDescribe(null); setSelected(undefined); setBusy(false);
      if (requestIdRef.current) void call('soql.abort', { requestId: requestIdRef.current }).catch(() => {});
      requestIdRef.current = null;
      try {
        const payload = (await call('soql.describeGlobal', { forceRefresh })) as
          | { ok: true; catalogs: SoqlDescribeCatalogs; org: PublicOrgView }
          | RpcFail;
        if (generation !== epoch.current) return;
        if (!payload || payload.ok !== true) {
          const failed = payload as RpcFail;
          setOrg(null);
          setOrgError(failed?.error || emptyOrgMessage());
          return;
        }
        setOrg(payload.org);
        setCatalogs(payload.catalogs);
        void loadAccessories(payload.org.alias, generation);
      } catch (err) {
        if (generation !== epoch.current) return;
        setOrg(null);
        setOrgError(err instanceof Error ? err.message : emptyOrgMessage());
      }
    },
    [call, loadAccessories]
  );

  useEffect(() => {
    void loadOrgAndSchema();
    const changed = (event: Event) => {
      if ((event as CustomEvent).detail?.projectId === (props.projectId ?? null)) void loadOrgAndSchema(true);
    };
    window.addEventListener('sf:context-changed', changed);
    return () => {
      epoch.current += 1;
      window.removeEventListener('sf:context-changed', changed);
      if (requestIdRef.current) void call('soql.abort', { requestId: requestIdRef.current }).catch(() => {});
    };
  }, [loadOrgAndSchema, call, props.projectId]);

  const selectSObject = async (name: string) => {
    const generation = epoch.current;
    const selection = ++describeEpoch.current;
    setSelected(name); setDescribe(null);
    setSoql(current => seedQueryForSObject(name, current));
    try {
      const payload = requireResult<{ describe: SoqlSObjectDescribe }>(await call('soql.describeSObject', { sobject: name, useToolingApi, orgAlias: org?.alias }));
      if (generation === epoch.current && selection === describeEpoch.current) setDescribe(payload.describe);
    } catch (err) { if (generation === epoch.current && selection === describeEpoch.current) setError({ message: String(err) }); }
  };

  useSalesforceControl({ pluginId, projectId: props.projectId, orgAlias: props.orgAlias, threadId: props.threadId, surface: 'data',
    commands: ['state', 'query.set', 'object.select', 'record.open', 'filter.set', 'query.show'],
    state: () => ({ query: soql, objectName: selected, useToolingApi, includeDeleted, busy, rows: result?.records?.length ?? 0, filter: tableSearch, schemaFilter: schemaSearch }),
    execute: async ({ command, input }) => {
      if (command === 'state') return;
      if (command === 'query.set') {
        if (busy || input.expectedQuery !== soql) throw Error('Read the current view state and provide expectedQuery; the query may have changed.');
        setSoql(controlText(input, 'query', 20_000));
        if (typeof input.useToolingApi === 'boolean') setUseToolingApi(input.useToolingApi);
        if (typeof input.includeDeleted === 'boolean') setIncludeDeleted(input.includeDeleted);
      } else if (command === 'object.select') {
        const name = controlText(input, 'objectName', 160);
        if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) throw Error('Choose an object API name.');
        if (input.expectedQuery !== soql) throw Error('Read the current query before selecting an object.');
        await selectSObject(name);
      } else if (command === 'record.open') {
        const data = requireResult<{ record: Record<string, unknown> }>(await call('records.get', { recordId: controlText(input, 'recordId', 18), objectName: controlText(input, 'objectName', 160) }));
        setInspected(data.record);
      } else if (command === 'filter.set') {
        if (input.target === 'schema') setSchemaSearch(controlText(input, 'query', 200)); else setTableSearch(controlText(input, 'query', 200));
      } else if (command === 'query.show') {
        const data = requireResult<{ result: QueryState }>(await call('query.result', { resultId: controlText(input, 'resultId', 80) }));
        setResult(data.result); setError(null);
      }
    },
  });

  const run = async () => {
    if (!runEnabled) return;
    const generation = epoch.current;
    setBusy(true);
    setError(null);
    setExplain(null);
    const requestId = newRequestId();
    requestIdRef.current = requestId;
    try {
      const payload = (await call('soql.query', {
        soql,
        useToolingApi,
        includeDeleted,
        requestId, orgAlias: org?.alias
      })) as (QueryState & { ok: true }) | RpcFail;
      if (generation !== epoch.current) return;
      if (!payload || payload.ok !== true) {
        const failed = payload as RpcFail;
        setError({ message: failed?.error || 'Query failed.', line: failed?.line, column: failed?.column });
        return;
      }
      setResult({ ...payload, useToolingApi, includeDeleted });
      const history = (await call('soql.history.list', { orgAlias: org?.alias })) as
        | { ok: true; recent: SoqlHistoryItem[] }
        | RpcFail;
      if (generation === epoch.current && history && history.ok === true) setRecent(history.recent);
    } catch (err) {
      if (generation === epoch.current) setError({ message: err instanceof Error ? err.message : String(err) });
    } finally {
      if (requestIdRef.current === requestId) requestIdRef.current = null;
      if (generation === epoch.current) setBusy(false);
    }
  };

  const abort = async () => {
    const requestId = requestIdRef.current;
    if (!requestId) return;
    const generation = ++epoch.current;
    requestIdRef.current = null;
    setBusy(false);
    await call('soql.abort', { requestId }).catch(err => {
      if (generation === epoch.current) setError({ message: String(err) });
    });
  };

  const loadMore = async (loadAll = false, approved = false) => {
    if (!result?.nextRecordsUrl) return;
    if (loadAll && !approved) { setDialog({ title: 'Load more records', message: confirmLoadAll(result.records?.length ?? 0, result.totalSize ?? 0, EXPLORER_LOAD_ALL_CAP), confirm: () => { setDialog(null); void loadMore(true, true); } }); return; }
    const generation = epoch.current;
    const requestId = newRequestId();
    requestIdRef.current = requestId;
    setBusy(true);
    setError(null);
    try {
      let current = result;
      let guard = 0;
      do {
        const payload = (await call('soql.queryMore', {
          nextRecordsUrl: current.nextRecordsUrl,
          soql: current.soql,
          sobjectName: current.sobjectName,
          useToolingApi: current.useToolingApi,
          includeDeleted: current.includeDeleted, orgAlias: org?.alias, requestId
        })) as (QueryPage & { ok: true }) | RpcFail;
        if (generation !== epoch.current) return;
        if (!payload || payload.ok !== true) {
          const failed = payload as RpcFail;
          setError({ message: failed?.error || 'Could not load more records.' });
          break;
        }
        current = truncateToCap(mergeQueryPage(current, payload), EXPLORER_LOAD_ALL_CAP);
        setResult(current);
        guard += 1;
      } while (loadAll && current.nextRecordsUrl && guard < 50);
    } catch (err) {
      if (generation === epoch.current) setError({ message: err instanceof Error ? err.message : String(err) });
    } finally {
      if (requestIdRef.current === requestId) requestIdRef.current = null;
      if (generation === epoch.current) setBusy(false);
    }
  };

  const runExplain = async () => {
    const generation = epoch.current;
    try {
      const payload = requireResult<{ plans: unknown }>(await call('soql.explain', { soql, useToolingApi, orgAlias: org?.alias }));
      if (generation === epoch.current) setExplain(JSON.stringify(payload.plans, null, 2));
    } catch (err) { if (generation === epoch.current) setError({ message: String(err) }); }
  };

  const exportResult = async (kind: 'csv' | 'json' | 'copy-json' | 'copy-csv' | 'copy-tsv', approved = false) => {
    const records = flattenRecords(result?.records ?? []);
    if (records.length === 0) return;
    if (!approved) {
      const generation = epoch.current;
      setDialog({ title: 'Export query results', message: confirmExport(records.length), confirm: () => {
        setDialog(null);
        void exportResult(kind, true).catch(err => {
          if (generation === epoch.current) setError({ message: String(err) });
        });
      } });
      return;
    }
    const columns = discoverColumns(result?.records ?? []);
    if (kind === 'json' || kind === 'copy-json') {
      const text = recordsToJson(records);
      if (kind === 'json') downloadText('soql.json', text, 'application/json');
      else await copyText(text);
      return;
    }
    if (kind === 'copy-tsv') {
      await copyText(recordsToTsv(columns, records));
      return;
    }
    const csv = recordsToCsv(columns, records);
    if (kind === 'csv') downloadText('soql.csv', csv, 'text/csv');
    else await copyText(csv);
  };

  const saveQuery = (name: string) => {
    const generation = epoch.current;
    setDialog(null);
    void call('soql.history.save', { kind: 'saved', name, soql, useToolingApi, includeDeleted, orgAlias: org?.alias }).then(raw => {
      const payload = requireResult<{ saved: SoqlHistoryItem[] }>(raw);
      if (generation === epoch.current) setSaved(payload.saved);
    }).catch(err => {
      if (generation === epoch.current) setError({ message: String(err) });
    });
  };

  const removeQuery = (kind: 'recent' | 'saved', id: string) => {
    const generation = epoch.current;
    void call('soql.history.remove', { kind, id, orgAlias: org?.alias }).then(raw => {
      const payload = requireResult<{ recent?: SoqlHistoryItem[]; saved?: SoqlHistoryItem[] }>(raw);
      if (generation !== epoch.current) return;
      if (payload.recent) setRecent(payload.recent);
      if (payload.saved) setSaved(payload.saved);
    }).catch(err => {
      if (generation === epoch.current) setError({ message: String(err) });
    });
  };

  const entries: SObjectListEntry[] = useMemo(
    () => (useToolingApi ? catalogs.tooling : catalogs.standard),
    [catalogs, useToolingApi]
  );

  return (
    <div className="sf-surface sf-soql" data-testid="soql-explorer" style={PANEL_ROOT}>
      <style>{SALESFORCE_STYLES + SOQL_HOST_STYLES + SOQL_RESPONSIVE_STYLES}</style>
      <header className="sf-soql-header">
        <span className="sf-soql-brand">SOQL</span>
        {props.orgAlias ? <OrgBadge org={org ?? { alias: props.orgAlias, kind: 'unknown' }} /> : <OrgPicker pluginId={pluginId} projectId={props.projectId} disabled={busy} compact />}
        {org && !props.orgAlias ? <span className="sf-soql-chip">{orgChip(org)}</span> : null}
        {apiUsage ? <span className="sf-soql-chip">API {apiUsage}</span> : null}
        <span className="sf-soql-spacer" />
        {busy ? (
          <button type="button" className="sf-soql-btn" data-testid="soql-abort" onClick={() => void abort()}>
            Abort
          </button>
        ) : (
          <button
            type="button"
            className="sf-soql-btn primary"
            data-testid="soql-run"
            disabled={!runEnabled}
            onClick={() => void run()}
          >
            Run
          </button>
        )}
        <button type="button" className="sf-soql-btn" disabled={!soql.trim() || busy} onClick={() => void runExplain()}>
          Explain
        </button>
        <button type="button" className="sf-soql-btn" disabled={!soql.trim() || !org} onClick={() => setDialog({ title: 'Save query', input: selected || 'Query', confirm: saveQuery })}>Save query</button>
        <button type="button" className="sf-soql-btn" data-testid="soql-history-toggle" onClick={() => setHistoryOpen((open) => !open)}>
          History
        </button>
      </header>
      {orgError ? <div className="sf-soql-banner is-error">{orgError}</div> : null}
      {accessoryErrors.length > 0 && <div className="sf-soql-banner" role="status">{accessoryErrors.join(' and ')} unavailable. Queries are still available. <button type="button" className="sf-soql-btn" onClick={() => org && void loadAccessories(org.alias, epoch.current)}>Retry details</button></div>}
      {banner ? <div className="sf-soql-banner is-warn">{banner}</div> : null}
      <div className="sf-soql-body">
        <SoqlSchemaRail
          collapsed={railCollapsed}
          onToggleCollapsed={() => setRailCollapsed((value) => !value)}
          search={schemaSearch}
          onSearch={setSchemaSearch}
          catalogs={catalogs}
          useToolingApi={useToolingApi}
          selected={selected}
          describe={describe}
          soql={soql}
          onSelectSObject={(name) => void selectSObject(name)}
          onToggleField={(path) => setSoql((current) => toggleField(current, path))}
          onToggleChild={(rel, field) => setSoql((current) => toggleChildField(current, rel, field))}
          onInsert={(snippet) => editorRef.current?.insert(snippet)}
          onRefresh={() => void loadOrgAndSchema(true)}
          busy={busy}
        />
        <div className="sf-soql-stage">
          <div className="sf-soql-split">
            <QueryEditorPane><SoqlEditor
              ref={editorRef}
              value={soql}
              onChange={setSoql}
              onRun={() => void run()}
              onSave={() => { if (org && soql.trim()) setDialog({ title: 'Save query', input: selected || 'Query', confirm: saveQuery }); }}
              options={<>
        <label className="sf-soql-toggle">
          <input
            type="checkbox"
            checked={useToolingApi}
            onChange={(event) => {
              setUseToolingApi(event.target.checked);
              setDescribe(null);
            }}
          />
          Tooling
        </label>
        <label className="sf-soql-toggle">
          <input
            type="checkbox"
            checked={includeDeleted}
            onChange={(event) => setIncludeDeleted(event.target.checked)}
          />
          Deleted
        </label>
              </>}
              catalogs={catalogs}
              useToolingApi={useToolingApi}
              describe={describe}
              error={error}
            /></QueryEditorPane>
            <div className="sf-soql-result-tools" aria-label="Result actions">
              <strong>Results</strong><span className="sf-soql-spacer" />
        <input
          className="sf-soql-search-table"
          value={tableSearch}
          onChange={(event) => setTableSearch(event.target.value)}
          placeholder="Search loaded rows…"
          aria-label="Search table"
        />

              <select className="sf-soql-btn" aria-label="Export results" value="" disabled={!result?.records?.length} onChange={event => void exportResult(event.target.value as 'csv' | 'json' | 'copy-tsv')}>
                <option value="" disabled>Export…</option><option value="csv">CSV file</option><option value="json">JSON file</option><option value="copy-tsv">Copy for Excel</option>
              </select>
            </div>
            {explain ? (
              <pre className="sf-soql-empty" data-testid="soql-explain">
                {explain}
              </pre>
            ) : (
              <SoqlResultsGrid
                records={result?.records ?? []}
                hasRun={result !== null}
                onSelectRecord={(record) => setInspected(record)}
                search={tableSearch}
                totalSize={result?.totalSize}
                hasMore={Boolean(result?.nextRecordsUrl)}
                busy={busy}
                onLoadMore={() => void loadMore(false)}
                onLoadAll={() => void loadMore(true)}
              />
            )}
          </div>
        </div>
        {inspected && <aside className="sf-soql-record"><div className="sf-toolbar"><strong>Record</strong><span className="sf-grow" /><button type="button" className="sf-btn quiet" onClick={() => setInspected(null)}>Close</button></div><RecordInspector record={inspected} org={org ?? undefined} onAddToPrompt={props.onAddToPrompt} />{props.onOpenRecord && org && result?.sobjectName && typeof inspected.Id === 'string' && <button type="button" className="sf-btn" onClick={() => props.onOpenRecord?.(String(inspected.Id), result.sobjectName!, org.alias)}>Open beside agent</button>}</aside>}
        <SoqlHistoryDrawer
          open={historyOpen}
          recent={recent}
          saved={saved}
          onClose={() => setHistoryOpen(false)}
          onSelect={(next, tooling, deleted) => {
            setSoql(next);
            setUseToolingApi(tooling);
            setIncludeDeleted(deleted);
          }}
          onSave={() => setDialog({ title: 'Save query', input: selected || 'Query', confirm: saveQuery })}
          onRemove={removeQuery}
        />
      </div>
      {dialog && <ActionDialog {...dialog} onClose={() => setDialog(null)} onConfirm={dialog.confirm} />}
      <span hidden>{entries.length}</span>
    </div>
  );
}

const SOQL_RESPONSIVE_STYLES = `
.sf-soql { position:relative; font-size:13px; }
.sf-soql .sf-soql-textarea { font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace; }
.sf-soql-editor-pane { flex:0 0 auto; min-height:140px; display:flex; flex-direction:column; }
.sf-query-divider { flex-shrink:0; height:7px; cursor:row-resize; touch-action:none; display:grid; place-items:center; background:var(--bg-base); border-bottom:1px solid var(--border); }
.sf-query-divider span { width:32px; height:2px; border-radius:2px; background:var(--border); }
.sf-query-divider:hover span,.sf-query-divider:focus-visible span { background:var(--accent); }
.sf-query-divider:focus-visible { outline:2px solid var(--accent); outline-offset:-2px; }
.sf-soql-result-tools { display:flex; align-items:center; flex-wrap:wrap; gap:8px; padding:10px 12px; border-bottom:1px solid var(--border); background:var(--bg-panel); font-size:12px; }
.sf-soql-result-tools strong { font-weight:600; }
.sf-soql-header .sf-soql-btn { height:30px; }
.sf-soql-result-tools .sf-soql-search-table { width:180px; }
.sf-soql-stage .sf-soql-editor-meta { padding:8px 12px; }
.sf-soql-editor-meta .sf-soql-hint { margin-left:auto; font-size:10px; }
.sf-soql-rail { width:240px; }
.sf-soql-table td { max-width:420px; overflow:hidden; text-overflow:ellipsis; }

.sf-soql-record { width:300px; flex-shrink:0; border-left:1px solid var(--border); overflow:auto; }
.sf-soql-header { background:var(--bg-panel); }
@container sf (max-width:900px) { .sf-soql-rail { width:200px; } .sf-soql-record { width:260px; } .sf-soql-history { position:absolute; right:0; top:100px; bottom:0; z-index:3; width:min(100%,300px); box-shadow:-10px 0 30px color-mix(in srgb,var(--text-primary) 8%,transparent); } }
@container sf (max-width:600px) { .sf-soql-rail:not(.is-collapsed) { width:150px; } .sf-soql-record { position:absolute; inset:0; width:auto; z-index:3; background:var(--bg-panel); } .sf-soql-header .sf-soql-chip { display:none; } .sf-soql-editor-meta .sf-soql-hint { display:none; } .sf-soql-result-tools .sf-soql-search-table { width:120px; } .sf-soql-search-table { width:120px; } }
`;
