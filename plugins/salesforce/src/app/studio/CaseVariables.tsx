import { useCallback, useEffect, useState } from 'react';
import { useRealtime } from '@zana-ai/zcc-plugin-sdk/app';
import type { ScenarioCase } from '../../../lib/studio-contract.js';
import { CONTEXT_CHANGED_CHANNEL } from '../../../lib/studio-contract.js';
import { CONTEXT_PRESETS_CHANGED, sameContext, type ContextPreset } from '../../../lib/preview-context-preset-contract.js';
import { parsePreviewContext, validateContextEntries, type PreviewContextField, type PreviewContextVariable } from '../../../lib/preview-context.js';
import { ScenarioVariables, contextEntries } from './ScenarioVariables.js';
import { SIMULATION_STYLES } from './simulation-styles.js';
import { useRunWorkspaceState } from './run-workspaces.js';

type Reply = { ok?: boolean; error?: string; presets?: ContextPreset[]; fields?: PreviewContextField[] };
export function CaseVariables({ scenario, path, source, projectId, rpc, disabled, onSave }: {
  scenario: ScenarioCase; path: string; source: string; projectId?: string; disabled: boolean;
  rpc(method: string, args: Record<string, unknown>): Promise<Reply>;
  onSave(values: PreviewContextVariable[], previous: PreviewContextVariable[]): Promise<void>;
}) {
  const workspace = JSON.stringify(['case-variables', projectId, path, scenario.id]);
  const [entries, setEntries] = useRunWorkspaceState(workspace, 'entries', () => contextEntries(scenario.contextVariables));
  const [saved, setSaved] = useRunWorkspaceState(workspace, 'saved', () => parsePreviewContext(scenario.contextVariables ?? []));
  const [presets, setPresets] = useState<ContextPreset[]>([]);
  const [fields, setFields] = useState<PreviewContextField[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision(value => value + 1), []);
  useRealtime(CONTEXT_PRESETS_CHANGED, payload => { if ((payload as { projectId?: string })?.projectId === projectId) reload(); });
  useRealtime(CONTEXT_CHANGED_CHANNEL, payload => { if ((payload as { projectId?: string })?.projectId === projectId) reload(); });
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setLoadError(''); setPresets([]); setFields([]);
    void Promise.all([rpc('agentPreview.presets.list', { path }), rpc('agentPreview.context', { source })]).then(([listed, discovered]) => {
      if (cancelled) return;
      if (listed.ok === false || discovered.ok === false) throw Error(listed.error || discovered.error || 'Could not load variable presets.');
      setPresets(listed.presets ?? []); setFields(discovered.fields ?? []);
    }).catch(error => { if (!cancelled) setLoadError((error as Error).message); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [path, source, rpc, revision]);
  const parsed = validateContextEntries(entries);
  const invalid = Boolean(parsed.errors.length || Object.keys(parsed.fieldErrors).length);
  const changed = invalid || !sameContext(parsed.values, saved);
  const externalChange = !sameContext(saved, scenario.contextVariables ?? []);
  const save = async () => {
    if (invalid || !changed || saving || disabled || externalChange) return;
    const values = parsePreviewContext(parsed.values);
    setSaving(true); setSaveError(''); setNotice('');
    try { await onSave(values, saved); setSaved(values); setNotice('Starting variables saved. The next replay will use these values.'); }
    catch (error) { setSaveError((error as Error).message); }
    finally { setSaving(false); }
  };
  return <div className="sf-case-variables">
    <style>{SIMULATION_STYLES}{`.sf-case-variables fieldset{border:0;padding:0;margin:0;min-width:0}.sf-case-variables .sf-sim-variables{border-top:0;padding-top:0;margin-top:0}.sf-case-variables .sf-sim-variables select{max-width:100%;padding:9px;border:1px solid var(--sf-border);border-radius:6px;color:var(--sf-text);background:var(--sf-bg)}.sf-case-variables .sf-tp-bar{margin-top:18px}`}</style>
    <fieldset disabled={disabled || saving}>
      {externalChange && <p role="status">This case has newer saved variables. <button type="button" className="sf-tp-btn" onClick={() => { const values = parsePreviewContext(scenario.contextVariables ?? []); setEntries(contextEntries(values)); setSaved(values); setSaveError(''); setNotice(''); }}>Reload saved values</button></p>}
      <ScenarioVariables entries={entries} fields={fields} presets={presets} presetsLoading={loading} presetsError={loadError} onReloadPresets={reload}
        defaultsLabel="Runtime defaults" description="Starting values saved with this case for its next replay." onChange={entries => { setEntries(entries); setNotice(''); }} />
      <div className="sf-tp-bar"><button type="button" className="sf-tp-btn is-primary" disabled={!changed || invalid || externalChange} onClick={() => void save()}>{saving ? 'Saving…' : 'Save case variables'}</button><button type="button" className="sf-tp-btn" disabled={!changed} onClick={() => { setEntries(contextEntries(saved)); setSaveError(''); setNotice(''); }}>Discard changes</button></div>
    </fieldset>
    {changed && <p className="sf-tp-sub">Unsaved values. Save before running this case. Changes apply to the next replay.</p>}
    {notice && <p role="status">{notice}</p>}{saveError && <p role="alert">{saveError}</p>}
  </div>;
}
