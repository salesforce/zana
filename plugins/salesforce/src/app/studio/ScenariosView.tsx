import { useEffect, useRef, useState } from 'react';
import { callPluginRpc, useRealtime } from '@zana-ai/zcc-plugin-sdk/app';
import { CONTEXT_PRESETS_CHANGED, type ContextPreset } from '../../../lib/preview-context-preset-contract.js';
import { CONTEXT_CHANGED_CHANNEL } from '../../../lib/studio-contract.js';
import { parseLabScenario } from '../../../lib/agentforce-lab-contract.js';
import { validateContextEntries, type PreviewContextField } from '../../../lib/preview-context.js';
import { type SavedScenario } from '../../../lib/scenario-library-contract.js';
import { DuplicateScenarioDialog } from './DuplicateScenarioDialog.js';
import { contextEntries } from './ScenarioVariables.js';
import { SimulationScenarios, type EditableScenario } from './SimulationScenarios.js';
import { SIMULATION_STYLES } from './simulation-styles.js';
import { useRunWorkspaceState } from './run-workspaces.js';
import type { ScenarioLibraryControls } from './useScenarioLibrary.js';

type Draft = { row: EditableScenario; revision?: number };
export function ScenariosView({ library, pluginId, projectId, path, source, call = callPluginRpc, onRoleplay, onBatch }: {
  library: ScenarioLibraryControls; pluginId: string; projectId?: string; path: string; source: string; call?: typeof callPluginRpc;
  onRoleplay(scenario: SavedScenario): void; onBatch(scenario: SavedScenario): void;
}) {
  const key = JSON.stringify(['shared-scenario-drafts', pluginId, projectId, path]);
  const [drafts, setDrafts] = useRunWorkspaceState<Record<string, Draft>>(key, 'drafts', {});
  const [active, setActive] = useRunWorkspaceState(key, 'selected', '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(''); const [error, setError] = useState('');
  const [copyName, setCopyName] = useState<string | null>(null);
  const menu = useRef<HTMLDetailsElement>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [presets, setPresets] = useState<ContextPreset[]>([]); const [fields, setFields] = useState<PreviewContextField[]>([]);
  const [presetsError, setPresetsError] = useState(''); const [presetsLoading, setPresetsLoading] = useState(true); const [reload, setReload] = useState(0);
  useEffect(() => {
    let cancelled = false; setPresetsLoading(true); setPresetsError('');
    void Promise.all([call(pluginId, 'agentPreview.presets.list', { projectId, path }), call(pluginId, 'agentPreview.context', { projectId, source })]).then(values => {
      if (cancelled) return;
      const [listed, discovered] = values as Array<{ ok?: boolean; error?: string; fields?: PreviewContextField[]; presets?: ContextPreset[] }>;
      if (!listed?.ok || !discovered?.ok) throw Error(listed?.error || discovered?.error || 'Variable presets could not be loaded.');
      setPresets(listed.presets ?? []); setFields(discovered.fields ?? []);
    }).catch(error => { if (!cancelled) setPresetsError((error as Error).message); }).finally(() => { if (!cancelled) setPresetsLoading(false); });
    return () => { cancelled = true; };
  }, [pluginId, projectId, path, source, call, reload]);
  useRealtime(CONTEXT_PRESETS_CHANGED, payload => { const row = payload as { projectId?: string }; if (row?.projectId === projectId) setReload(value => value + 1); });
  useRealtime(CONTEXT_CHANGED_CHANNEL, () => setReload(value => value + 1));
  const rows: EditableScenario[] = [...library.scenarios.map(row => drafts[row.id]?.row ?? { ...row, key: row.id }), ...Object.entries(drafts).filter(([id]) => !library.scenarios.some(row => row.id === id)).map(([, draft]) => draft.row)];
  const selected = rows.find(row => row.key === active) ?? rows[0];
  const saved = library.scenarios.find(row => row.id === selected?.key);
  const draft = selected ? drafts[selected.key] : undefined;
  const parsed = validateContextEntries(selected?.contextEntries ?? contextEntries(selected?.contextVariables));
  let definitionError = '';
  if (selected) { try { parseLabScenario(selected); if (!selected.name.trim()) definitionError = 'Give this scenario a name.'; } catch (error) { definitionError = (error as Error).message; } }
  const invalid = Boolean(definitionError || parsed.errors.length || Object.keys(parsed.fieldErrors).length);
  const discard = (id: string) => setDrafts(previous => { const next = { ...previous }; delete next[id]; return next; });
  const perform = async (work: () => Promise<void>) => { setBusy(true); setError(''); setMessage(''); try { await work(); } catch (error) { setError((error as Error).message); } finally { setBusy(false); } };
  const save = (copy = false) => {
    if (!selected || invalid) return;
    void perform(async () => {
      const result = await library.save({ ...parseLabScenario(selected), name: copy ? copyName ?? selected.name : selected.name, contextVariables: parsed.values }, copy ? undefined : saved?.id ?? (draft?.revision ? selected.key : undefined), copy ? undefined : draft?.revision ?? saved?.revision);
      if (!copy) discard(selected.key); setActive(result.id); setCopyName(null); setMessage(`Saved “${result.name}” · revision ${result.revision}.`);
    });
  };
  const add = () => {
    const id = `draft-${crypto.randomUUID()}`;
    setDrafts(previous => ({ ...previous, [id]: { row: { key: id, name: 'New scenario', persona: '', goal: '', opening: 'Hello', criteria: '', maxTurns: 4 } } })); setActive(id); setMessage(''); setError('');
  };
  return <div className="sf-sim sf-scenario-library" data-testid="studio-scenarios">
    <style>{SIMULATION_STYLES}{`.sf-scenario-library{flex:1;min-height:0;overflow:hidden}.sf-scenario-library>:not(.sf-sim-workspace){flex-shrink:0}.sf-scenario-library .sf-sim-workspace{flex:1;min-height:0}.sf-scenario-library .sf-sim-editor{overflow:auto;overscroll-behavior:contain}.sf-scenario-library .sf-sim-catalogue{min-height:0}.sf-scenario-library .sf-sim-scenarios{flex:1;min-height:0}.sf-scenario-library .sf-scenario-actions{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:12px 0;border-top:1px solid var(--sf-border);background:var(--sf-bg)}.sf-scenario-save,.sf-scenario-use>div,.sf-scenario-header-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.sf-scenario-use{display:flex;align-items:flex-end;flex-direction:column;gap:6px}.sf-scenario-actions .is-primary:not(:disabled){background:var(--sf-accent);border-color:var(--sf-accent);color:var(--sf-on-accent)}.sf-scenario-menu{position:relative}.sf-scenario-menu summary{list-style:none;cursor:pointer;border:1px solid var(--sf-border);border-radius:6px;padding:7px 12px;font-weight:700}.sf-scenario-menu summary::-webkit-details-marker{display:none}.sf-scenario-menu>div{position:absolute;right:0;top:100%;z-index:10;padding:6px;background:var(--sf-bg);border:1px solid var(--sf-border);border-radius:8px;box-shadow:0 4px 16px #0002;min-width:190px}.sf-scenario-menu button{background:none;color:var(--sf-text);border:0;border-radius:4px;padding:10px;width:100%;text-align:left;font:inherit;cursor:pointer}.sf-scenario-menu button:hover{background:var(--sf-soft)}.sf-scenario-menu :focus-visible{outline:2px solid var(--sf-accent);outline-offset:2px}.sf-scenario-library .sf-scenario-status{margin:0 0 8px}.sf-scenario-library .sf-scenario-copy{display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:12px;border:1px solid var(--sf-border);border-radius:8px}.sf-scenario-library .sf-scenario-copy input{font:inherit;padding:7px;border:1px solid var(--sf-border);border-radius:6px;background:var(--sf-bg);color:var(--sf-text)}`}</style>
    <header className="sf-sim-heading"><div><h2>Scenarios</h2><p>Reusable customer setups for Role-play and Batch simulations.</p></div><div className="sf-scenario-header-actions"><button className="sf-tp-btn" type="button" disabled={library.loading || busy} onClick={library.reload}>Reload scenarios</button>
      {selected && <details ref={menu} className="sf-scenario-menu" onKeyDown={event => { if (event.key === 'Escape') { menu.current!.open = false; menu.current?.querySelector('summary')?.focus(); } }} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) event.currentTarget.open = false; }}><summary tabIndex={0} aria-label="Scenario actions">⋯</summary><div><button type="button" disabled={busy || invalid} onClick={() => { menu.current!.open = false; menu.current?.querySelector('summary')?.focus(); setError(''); setCopyName(`${selected.name} copy`.slice(0, 80)); }}>Duplicate scenario…</button></div></details>}
    </div></header>
    {library.error && <p role="alert">{library.error}</p>}{error && copyName === null && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {library.loading && !rows.length ? <p role="status">Loading scenarios…</p> : <SimulationScenarios variant="library" storageKey={`salesforce:studio:scenario-library:${projectId}:${path}`} scenarios={rows} activeKey={selected?.key ?? ''} included={[]} attention={new Set()} disabled={busy || library.loading}
      contextPresets={presets} contextFields={fields} presetsLoading={presetsLoading} presetsError={presetsError} onReloadPresets={() => setReload(value => value + 1)}
      onSelect={id => { setActive(id); setCopyName(null); setError(''); setMessage(''); }} onToggle={() => {}}
      onEdit={(id, patch) => { const row = rows.find(row => row.key === id)!; setDrafts(previous => ({ ...previous, [id]: { row: { ...row, ...patch }, revision: previous[id]?.revision ?? library.scenarios.find(row => row.id === id)?.revision } })); setMessage(''); }}
      onAdd={add} onRemove={id => { if (library.scenarios.some(row => row.id === id)) setRemoving(id); else discard(id); }} />}
    {selected && <>
      {draft && definitionError && <p role="status">{definitionError}</p>}
      <p className="sf-tp-sub sf-scenario-status">{saved ? `Revision ${saved.revision}` : 'New scenario'}{draft ? ' · Unsaved changes. Save before reusing this setup.' : ' · Changes to shared scenarios apply to future selections.'}</p>
      <footer className="sf-scenario-actions" aria-label="Scenario editing actions">
        <div className="sf-scenario-save"><button className="sf-tp-btn is-primary" type="button" disabled={busy || library.loading || invalid || !draft} onClick={() => save()}>{busy ? 'Saving…' : 'Save changes'}</button>
          {draft && <button className="sf-tp-btn" type="button" disabled={busy} onClick={() => discard(selected.key)}>Discard</button>}</div>
        <div className="sf-scenario-use">{draft && <span id="scenario-save-hint" className="sf-tp-sub">Save your changes before using this scenario.</span>}<div>
          <button className="sf-tp-btn" type="button" aria-describedby={draft ? 'scenario-save-hint' : undefined} disabled={busy || Boolean(draft) || !saved} onClick={() => saved && onRoleplay(structuredClone(saved))}>Try in Role-play</button><button className="sf-tp-btn" type="button" aria-describedby={draft ? 'scenario-save-hint' : undefined} disabled={busy || Boolean(draft) || !saved} onClick={() => saved && onBatch(structuredClone(saved))}>Add to batch</button>
        </div></div>
      </footer>
      {copyName !== null && <DuplicateScenarioDialog returnFocus={menu.current?.querySelector('summary')} name={copyName} busy={busy} error={error} onName={setCopyName} onCreate={() => save(true)} onClose={() => { setCopyName(null); setError(''); }} />}

    </>}
    {removing && <div role="alertdialog" aria-label="Remove shared scenario" className="sf-scenario-copy"><p>Remove this shared scenario? Existing runs and saved test cases keep their setup.</p><button className="sf-tp-btn" disabled={busy} onClick={() => void perform(async () => { const row = library.scenarios.find(row => row.id === removing); if (row) await library.remove(row); discard(removing); setRemoving(null); })}>Remove scenario</button><button className="sf-tp-btn" disabled={busy} onClick={() => setRemoving(null)}>Keep scenario</button></div>}
  </div>;
}
