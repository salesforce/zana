import { useId, useState } from 'react';
import type { OperationKind } from '../../../lib/workbench-contract.js';
import type { SalesforcePanelProps } from './WorkbenchPanels.js';
import { useSalesforceCall, requireResult } from '../components/client.js';
import { useSalesforceDraft } from '../components/drafts.js';
import { useResource } from '../components/use-resource.js';
import { ErrorState, LoadingState, SalesforcePanelFrame } from '../components/ui.js';
import { needsOperationThread, operationReviewDraft } from '../operation-review.js';
import { OperationsPanel } from './OperationsPanel.js';

const METADATA_TYPES = { ApexClass: 'Apex classes', ApexTrigger: 'Apex triggers', LightningComponentBundle: 'Lightning components', CustomObject: 'Objects', PermissionSet: 'Permission sets', Flow: 'Flows' };

export function DeploymentsPanel(props: SalesforcePanelProps) {
  const id = useId();
  const draftKey = `${props.projectId ?? 'global'}:${props.threadId ?? 'project'}:deploy`;
  const call = useSalesforceCall(props.pluginId, props, props.threadId);
  const [components, setComponents] = useSalesforceDraft(`${draftKey}:components`);
  const [tests, setTests] = useSalesforceDraft(`${draftKey}:tests`);
  const [type, setType] = useState('ApexClass');
  const [browseType, setBrowseType] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const metadata = useResource<{ records: Array<{ fullName: string }>; truncated?: boolean }>(call, browseType ? 'metadata.list' : null, { metadataType: browseType });
  const selected = [...new Set(components.split(/[\n,]+/).map(value => value.trim()).filter(Boolean))];
  const visible = (metadata.data?.records ?? []).filter(row => row.fullName.toLowerCase().includes(search.toLowerCase())).sort((a, b) => a.fullName.localeCompare(b.fullName, undefined, { numeric: true }));
  function toggle(key: string, checked: boolean) { setComponents((checked ? [...selected, key] : selected.filter(value => value !== key)).join('\n')); }
  async function run(kind: OperationKind) {
    const input = { components: selected, tests: tests.split(/[\s,]+/).filter(Boolean) };
    if (!props.threadId && needsOperationThread(kind)) { props.onAddToPrompt?.(operationReviewDraft(kind, props.orgAlias, input)); return; }
    setBusy(true); setError(null);
    try { requireResult(await call('operations.start', { kind, ...input })); setRevision(value => value + 1); }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { setBusy(false); }
  }
  return <SalesforcePanelFrame>
    <div className="sf-workspace sf-deploy-workspace">
      <div className="sf-workspace-config">
        <div className="sf-workspace-heading"><div><span className="sf-eyebrow">Deployments</span><h2>Prepare a change</h2></div></div>
        <div className="sf-target-strip"><span>Target org</span><strong>{props.orgAlias || 'Project default'}</strong></div>
        {error && <ErrorState message={error} />}
        <section className="sf-workspace-section" aria-labelledby={`${id}-components`}>
          <h3 id={`${id}-components`}><span className="sf-step">1</span> Choose components</h3>
          <div className="sf-control-row">
            <select className="sf-select" aria-label="Metadata type" value={type} onChange={event => { setType(event.target.value); setBrowseType(null); setSearch(''); }}>
              {Object.entries(METADATA_TYPES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <button className="sf-btn" type="button" disabled={metadata.busy} onClick={() => { if (browseType === type) void metadata.refresh(); else setBrowseType(type); }}>Browse org metadata</button>
          </div>
          {metadata.error && <ErrorState message={metadata.error} />}
          {metadata.busy && <LoadingState />}
          {metadata.data ? <div className="sf-metadata-browser">
            <input className="sf-input" aria-label="Search metadata" placeholder="Search components…" value={search} onChange={event => setSearch(event.target.value)} />
            <div className="sf-metadata-list" role="group" aria-label="Available metadata">
              {visible.map(row => <label className="sf-metadata-option" key={row.fullName}>
                <input type="checkbox" aria-label={`Select ${row.fullName}`} checked={selected.includes(`${browseType}:${row.fullName}`)} onChange={event => toggle(`${browseType}:${row.fullName}`, event.target.checked)} />
                <span>{row.fullName}</span>
              </label>)}
              {!visible.length && <p className="sf-muted">No matching components.</p>}
            </div>
            <p className="sf-list-caption">{visible.length} shown{metadata.data.truncated ? ' · First 200 components loaded' : ''}</p>
          </div> : !metadata.busy && !metadata.error && <p className="sf-section-hint">Browse your org or enter component names below.</p>}
          <div className="sf-selection-heading"><strong>{selected.length} selected</strong>{selected.length > 0 && <button className="sf-btn quiet" type="button" onClick={() => setComponents('')}>Clear selection</button>}</div>
          {selected.length > 0 && <div className="sf-selection-chips" aria-label="Selected metadata">{selected.map(key => <span className="sf-selection-chip" key={key}><span title={key}>{key}</span><button type="button" aria-label={`Remove ${key}`} onClick={() => toggle(key, false)}>×</button></span>)}</div>}
          <details className="sf-inline-details"><summary>Enter component names</summary><label className="sf-field">Selected components<textarea className="sf-input" placeholder="ApexClass:OrderService" value={components} onChange={event => setComponents(event.target.value)} /></label></details>
        </section>
        <section className="sf-workspace-section" aria-labelledby={`${id}-tests`}>
          <h3 id={`${id}-tests`}><span className="sf-step">2</span> Validate the change</h3>
          <label className="sf-field">Targeted Apex tests<input className="sf-input" placeholder="OrderServiceTest" value={tests} onChange={event => setTests(event.target.value)} /></label>
          <p className="sf-section-hint">Separate test classes with commas. Preview does not require tests.</p>
          <div className="sf-control-row">
            <button className="sf-btn" type="button" disabled={busy || !selected.length} onClick={() => void run('deploy.preview')}>Preview deployment</button>
            <button className="sf-btn" type="button" disabled={busy || !selected.length || !tests.trim()} onClick={() => void run('deploy.validate')}>Validate</button>
          </div>
        </section>
        <section className="sf-workspace-section sf-review-step">
          <h3><span className="sf-step">3</span> Review & deploy</h3>
          <button className="sf-btn primary" type="button" disabled={busy || !selected.length || !tests.trim() || (!props.threadId && !props.onAddToPrompt)} onClick={() => void run('deploy.start')}>{props.threadId ? 'Review and deploy' : 'Review deployment in a thread'}</button>
          <p className="sf-section-hint">{props.threadId ? 'Review the selected components before approving deployment.' : 'Continue in a thread with this org and selection. Nothing runs automatically.'}</p>
          <details className="sf-inline-details"><summary>Retrieve from org</summary><p className="sf-section-hint">Preview tracked changes, then review writing selected components to this project.</p><div className="sf-control-row">
            <button className="sf-btn" type="button" disabled={busy} onClick={() => void run('retrieve.preview')}>Preview tracked changes</button>
            <button className="sf-btn" type="button" disabled={busy || !selected.length || (!props.threadId && !props.onAddToPrompt)} onClick={() => void run('retrieve.start')}>{props.threadId ? 'Review and retrieve selected' : 'Review retrieval in a thread'}</button>
          </div></details>
        </section>
      </div>
      <OperationsPanel {...props} revision={revision} scope="deployments" />
    </div>
  </SalesforcePanelFrame>;
}
