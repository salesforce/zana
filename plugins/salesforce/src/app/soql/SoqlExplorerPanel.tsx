import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { callPluginRpc } from '@zana-ai/zcc-plugin-sdk/app';
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
import { OrgPicker } from '../OrgPicker.js';

const PLUGIN_ID = 'salesforce';
const PANEL_ROOT: CSSProperties = { height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' };
export const SOQL_HOST_STYLES = `
.sf-soql { --sf-soql-surface: var(--bg, #1a1d23); --sf-soql-elevated: var(--bg-panel, #22262e); --sf-soql-sunken: #14161b; --sf-soql-border: var(--border, #2c313a); --sf-soql-text: var(--text, #e6e8ec); --sf-soql-muted: var(--text-muted, #9aa1ad); --sf-soql-accent: #1b96ff; height: 100%; min-height: 0; display: flex; flex-direction: column; color: var(--sf-soql-text); background: var(--sf-soql-surface); }
.sf-soql-header { display: flex; align-items: center; gap: 10px; height: 48px; padding: 0 12px; flex-shrink: 0; background: var(--sf-soql-elevated); border-bottom: 1px solid var(--sf-soql-border); }
.sf-soql-brand { font-size: 13px; font-weight: 600; }
.sf-soql-chip { font-size: 12px; color: var(--sf-soql-muted); }
.sf-org-picker { font: inherit; font-size: 12px; color: var(--sf-soql-text); background: var(--sf-soql-sunken); border: 1px solid var(--sf-soql-border); border-radius: 6px; height: 28px; max-width: 280px; }
.sf-soql-spacer { flex: 1; }
.sf-soql-btn { height: 28px; padding: 0 10px; border-radius: 6px; border: 1px solid var(--sf-soql-border); background: transparent; color: var(--sf-soql-text); font-size: 12px; cursor: pointer; }
.sf-soql-btn.primary { background: var(--sf-soql-accent); border-color: transparent; color: #061121; font-weight: 600; }
.sf-soql-btn:disabled { opacity: .45; cursor: default; }
.sf-soql-toggle { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--sf-soql-muted); }
.sf-soql-banner { padding: 6px 12px; font-size: 12px; border-bottom: 1px solid var(--sf-soql-border); color: var(--sf-soql-muted); }
.sf-soql-banner.is-warn { color: #e8c07a; }
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
.sf-soql-editor { flex: 0 0 42%; min-height: 140px; display: flex; flex-direction: column; border-bottom: 1px solid var(--sf-soql-border); position: relative; }
.sf-soql-textarea { flex: 1; min-height: 0; resize: none; border: 0; padding: 12px; font: 13px/1.45 ui-monospace, SFMono-Regular, Menlo, Monaco, monospace; background: var(--sf-soql-surface); color: var(--sf-soql-text); }
.sf-soql-editor-meta { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-top: 1px solid var(--sf-soql-border); }
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

type QueryState = QueryPage & { soql?: string; sobjectName?: string };

type RpcFail = { ok: false; code?: string; error?: string; line?: number; column?: number };

export function SoqlExplorerPanel(props: { pluginId: string; projectId: string }) {
  const pluginId = props.pluginId || PLUGIN_ID;
  const editorRef = useRef<SoqlEditorHandle>(null);
  const requestIdRef = useRef<string | null>(null);
  const [org, setOrg] = useState<PublicOrgView | null>(null);
  const [orgError, setOrgError] = useState<string | null>(null);
  const [catalogs, setCatalogs] = useState<SoqlDescribeCatalogs>({ standard: [], tooling: [] });
  const [soql, setSoql] = useState(DEFAULT_SOQL);
  const [useToolingApi, setUseToolingApi] = useState(false);
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [selected, setSelected] = useState<string | undefined>();
  const [describe, setDescribe] = useState<SoqlSObjectDescribe | null>(null);
  const [schemaSearch, setSchemaSearch] = useState('');
  const [tableSearch, setTableSearch] = useState('');
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [recent, setRecent] = useState<SoqlHistoryItem[]>([]);
  const [saved, setSaved] = useState<SoqlHistoryItem[]>([]);
  const [result, setResult] = useState<QueryState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; line?: number; column?: number } | null>(null);
  const [apiUsage, setApiUsage] = useState<string | null>(null);
  const [explain, setExplain] = useState<string | null>(null);

  const hasOrg = Boolean(org);
  const banner = productionBanner(org);
  const runEnabled = canRun(soql, hasOrg, busy);

  const loadOrgAndSchema = useCallback(
    async (forceRefresh = false) => {
      setOrgError(null);
      try {
        const payload = (await callPluginRpc(pluginId, 'soql.describeGlobal', { forceRefresh })) as
          | { ok: true; catalogs: SoqlDescribeCatalogs; org: PublicOrgView }
          | RpcFail;
        if (!payload || payload.ok !== true) {
          const failed = payload as RpcFail;
          setOrg(null);
          setOrgError(failed?.error || emptyOrgMessage());
          return;
        }
        setOrg(payload.org);
        setCatalogs(payload.catalogs);
        const limits = (await callPluginRpc(pluginId, 'soql.limits')) as
          | { ok: true; dailyApiRequests?: { max: number; remaining: number } | null }
          | RpcFail;
        if (limits && limits.ok === true && limits.dailyApiRequests) {
          setApiUsage(`${limits.dailyApiRequests.remaining}/${limits.dailyApiRequests.max}`);
        }
        const history = (await callPluginRpc(pluginId, 'soql.history.list')) as
          | { ok: true; recent: SoqlHistoryItem[]; saved: SoqlHistoryItem[] }
          | RpcFail;
        if (history && history.ok === true) {
          setRecent(history.recent);
          setSaved(history.saved);
        }
      } catch (err) {
        setOrg(null);
        setOrgError(err instanceof Error ? err.message : emptyOrgMessage());
      }
    },
    [pluginId]
  );

  useEffect(() => {
    void loadOrgAndSchema();
  }, [loadOrgAndSchema]);

  const selectSObject = async (name: string) => {
    setSelected(name);
    setSoql((current) => seedQueryForSObject(name, current));
    const payload = (await callPluginRpc(pluginId, 'soql.describeSObject', {
      sobject: name,
      useToolingApi
    })) as { ok: true; describe: SoqlSObjectDescribe } | RpcFail;
    if (payload && payload.ok === true) setDescribe(payload.describe);
  };

  const run = async () => {
    if (!runEnabled) return;
    setBusy(true);
    setError(null);
    setExplain(null);
    const requestId = newRequestId();
    requestIdRef.current = requestId;
    try {
      const payload = (await callPluginRpc(pluginId, 'soql.query', {
        soql,
        useToolingApi,
        includeDeleted,
        requestId
      })) as (QueryState & { ok: true }) | RpcFail;
      if (!payload || payload.ok !== true) {
        const failed = payload as RpcFail;
        setError({ message: failed?.error || 'Query failed.', line: failed?.line, column: failed?.column });
        return;
      }
      setResult(payload);
      const history = (await callPluginRpc(pluginId, 'soql.history.list')) as
        | { ok: true; recent: SoqlHistoryItem[] }
        | RpcFail;
      if (history && history.ok === true) setRecent(history.recent);
    } finally {
      if (requestIdRef.current === requestId) requestIdRef.current = null;
      setBusy(false);
    }
  };

  const abort = async () => {
    const requestId = requestIdRef.current;
    if (!requestId) return;
    await callPluginRpc(pluginId, 'soql.abort', { requestId });
  };

  const loadMore = async (loadAll = false) => {
    if (!result?.nextRecordsUrl) return;
    if (loadAll && !window.confirm(confirmLoadAll(result.records?.length ?? 0, result.totalSize ?? 0, EXPLORER_LOAD_ALL_CAP))) {
      return;
    }
    setBusy(true);
    try {
      let current = result;
      let guard = 0;
      do {
        const payload = (await callPluginRpc(pluginId, 'soql.queryMore', {
          nextRecordsUrl: current.nextRecordsUrl,
          soql: current.soql,
          sobjectName: current.sobjectName,
          useToolingApi,
          includeDeleted
        })) as (QueryPage & { ok: true }) | RpcFail;
        if (!payload || payload.ok !== true) {
          const failed = payload as RpcFail;
          setError({ message: failed?.error || 'Could not load more records.' });
          break;
        }
        current = truncateToCap(mergeQueryPage(current, payload), EXPLORER_LOAD_ALL_CAP);
        setResult(current);
        guard += 1;
      } while (loadAll && current.nextRecordsUrl && guard < 50);
    } finally {
      setBusy(false);
    }
  };

  const runExplain = async () => {
    const payload = (await callPluginRpc(pluginId, 'soql.explain', { soql, useToolingApi })) as
      | { ok: true; plans: unknown }
      | RpcFail;
    if (!payload || payload.ok !== true) {
      setError({ message: (payload as RpcFail)?.error || 'Explain failed.' });
      return;
    }
    setExplain(JSON.stringify(payload.plans, null, 2));
  };

  const exportResult = async (kind: 'csv' | 'json' | 'copy-json' | 'copy-csv' | 'copy-tsv') => {
    const records = flattenRecords(result?.records ?? []);
    if (records.length === 0) return;
    if (!window.confirm(confirmExport(records.length))) return;
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

  const entries: SObjectListEntry[] = useMemo(
    () => (useToolingApi ? catalogs.tooling : catalogs.standard),
    [catalogs, useToolingApi]
  );

  return (
    <div className="sf-soql" data-testid="soql-explorer" style={PANEL_ROOT}>
      <style>{SOQL_HOST_STYLES}</style>
      <header className="sf-soql-header">
        <span className="sf-soql-brand">SOQL</span>
        <OrgPicker pluginId={pluginId} compact onSelect={() => void loadOrgAndSchema(true)} />
        {org ? <span className="sf-soql-chip">{orgChip(org)}</span> : null}
        {apiUsage ? <span className="sf-soql-chip">API {apiUsage}</span> : null}
        <span className="sf-soql-spacer" />
        <input
          className="sf-soql-search-table"
          value={tableSearch}
          onChange={(event) => setTableSearch(event.target.value)}
          placeholder="Search table…"
          aria-label="Search table"
        />
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
        <button type="button" className="sf-soql-btn" disabled={!result?.records?.length} onClick={() => void exportResult('csv')}>
          CSV
        </button>
        <button type="button" className="sf-soql-btn" disabled={!result?.records?.length} onClick={() => void exportResult('json')}>
          JSON
        </button>
        <button type="button" className="sf-soql-btn" disabled={!result?.records?.length} onClick={() => void exportResult('copy-tsv')}>
          Excel
        </button>
        <button type="button" className="sf-soql-btn" disabled={!soql.trim() || busy} onClick={() => void runExplain()}>
          Explain
        </button>
        <button type="button" className="sf-soql-btn" data-testid="soql-history-toggle" onClick={() => setHistoryOpen((open) => !open)}>
          History
        </button>
      </header>
      {orgError ? <div className="sf-soql-banner is-error">{orgError}</div> : null}
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
            <SoqlEditor
              ref={editorRef}
              value={soql}
              onChange={setSoql}
              onRun={() => void run()}
              catalogs={catalogs}
              useToolingApi={useToolingApi}
              describe={describe}
              error={error}
            />
            {explain ? (
              <pre className="sf-soql-empty" data-testid="soql-explain">
                {explain}
              </pre>
            ) : (
              <SoqlResultsGrid
                records={result?.records ?? []}
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
          onSave={() => {
            void callPluginRpc(pluginId, 'soql.history.save', {
              kind: 'saved',
              name: window.prompt('Saved query name', selected || 'Query') || 'Query',
              soql,
              useToolingApi,
              includeDeleted
            }).then((raw) => {
              const payload = raw as { ok?: boolean; saved?: SoqlHistoryItem[] };
              if (payload?.ok && payload.saved) setSaved(payload.saved);
            });
          }}
          onRemove={(kind, id) => {
            void callPluginRpc(pluginId, 'soql.history.remove', { kind, id }).then((raw) => {
              const payload = raw as { ok?: boolean; recent?: SoqlHistoryItem[]; saved?: SoqlHistoryItem[] };
              if (payload?.ok) {
                if (payload.recent) setRecent(payload.recent);
                if (payload.saved) setSaved(payload.saved);
              }
            });
          }}
        />
      </div>
      <span hidden>{entries.length}</span>
    </div>
  );
}
