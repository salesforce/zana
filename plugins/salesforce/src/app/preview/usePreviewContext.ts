import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useRunWorkspaceState } from '../studio/run-workspaces.js';
import { callPluginRpc, useRealtime } from '@zana-ai/zcc-plugin-sdk/app';
import { parsePreviewContext, validateContextEntries, type ContextEntry, type PreviewContextField, type PreviewContextVariable } from '../../../lib/preview-context.js';
import { CONTEXT_PRESETS_CHANGED, presetCompatibility, sameContext, type AppliedContextPreset, type ContextPreset, type ContextPresetList } from '../../../lib/preview-context-preset-contract.js';

const valueText = (row: PreviewContextVariable) => typeof row.value === 'string' ? row.value : JSON.stringify(row.value);
const toEntries = (rows: PreviewContextVariable[]) => Object.fromEntries(rows.map(r => [r.name, { type: r.type, text: r.value === null ? '' : valueText(r), ...(r.value === null ? { isNull: true } : {}) }]));
export function usePreviewContext(input: { pluginId: string; projectId?: string; scope: string; source?: string; path?: string; apiName?: string; orgAlias?: string }) {
  const id = useId();
  const workspaceKey = JSON.stringify(['context', input.pluginId, input.projectId ?? '', input.orgAlias ?? '', input.path ?? input.apiName ?? '', input.scope]);
  const [fields, setFields] = useState<PreviewContextField[]>([]);
  const [manual, setManual] = useRunWorkspaceState<PreviewContextField[]>(workspaceKey, 'manual', []);
  const [entries, setEntries] = useRunWorkspaceState<Record<string, ContextEntry>>(workspaceKey, 'entries', {});
  const [applied, setApplied] = useRunWorkspaceState<PreviewContextVariable[] | null>(workspaceKey, 'applied', null);
  const [appliedPreset, setAppliedPreset] = useRunWorkspaceState<AppliedContextPreset | null>(workspaceKey, 'appliedPreset', null);
  const [loading, setLoading] = useState(false);
  const [discoveryError, setDiscoveryError] = useState('');
  // Dialog visibility belongs to its mounted surface; sharing it opens duplicate portals.
  const [setup, setSetup] = useState(false);
  const [tab, setTab] = useRunWorkspaceState<'conversation' | 'scenarios' | 'context'>(workspaceKey, 'tab', 'conversation');
  const [presets, setPresets] = useState<ContextPreset[]>([]);
  const [selected, setSelected] = useRunWorkspaceState<ContextPreset | null>(workspaceKey, 'selected', null);
  const [presetScope, setPresetScope] = useState('');
  const [orgLabel, setOrgLabel] = useState('');
  const [presetError, setPresetError] = useState('');
  const [presetLoading, setPresetLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);
  const [touched, setTouched] = useRunWorkspaceState<Record<string, boolean>>(workspaceKey, 'touched', {});
  const [reviewErrors, setReviewErrors] = useRunWorkspaceState(workspaceKey, 'reviewErrors', false);
  const [undo, setUndo] = useRunWorkspaceState<{ entries: typeof entries; manual: typeof manual; selected: typeof selected; touched: typeof touched; reviewErrors: boolean } | null>(workspaceKey, 'undo', null);
  /** Names an agent set through context.set, until the person edits them. */
  const [agentSet, setAgentSet] = useRunWorkspaceState<Record<string, true>>(workspaceKey, 'agentSet', {});
  const discoveryScope = useRef<string | null>(null);
  const generation = useRef(0);
  const activeScope = useRef(input.scope); activeScope.current = input.scope;
  const selectedRef = useRef(selected); selectedRef.current = selected;
  const presetsEnabled = Boolean(input.projectId && (input.path || input.apiName));
  useEffect(() => {
    setSetup(false);
    setFields([]);
    generation.current++;
    setPresets([]); setPresetScope(''); setOrgLabel(''); setPresetError(''); setSaving(false);
    return () => { generation.current++; };
  }, [input.scope]);
  // An agent's contextPresets.save or remove shows up in the picker without a reload.
  useRealtime(CONTEXT_PRESETS_CHANGED, payload => {
    const projectId = payload && typeof payload === 'object' ? (payload as { projectId?: unknown }).projectId : undefined;
    if (presetsEnabled && (!projectId || projectId === input.projectId)) setReload(n => n + 1);
  });
  useEffect(() => {
    let cancelled = false;
    if (!presetsEnabled) return;
    setPresetLoading(true); setPresetError('');
    void callPluginRpc(input.pluginId, 'agentPreview.presets.list', { projectId: input.projectId, path: input.path, apiName: input.apiName, orgAlias: input.orgAlias }).then(result => {
      if (cancelled) return;
      const row = result as ContextPresetList | undefined;
      if (!row?.ok || !Array.isArray(row.presets) || !row.scopeKey) throw Error(row?.error || 'Presets could not be loaded.');
      setPresets(row.presets); setPresetScope(row.scopeKey); setOrgLabel(row.orgLabel ?? 'Selected org');
    }).catch(error => { if (!cancelled) { setPresetScope(''); setPresetError((error as Error).message); } })
      .finally(() => { if (!cancelled) setPresetLoading(false); });
    return () => { cancelled = true; };
  }, [input.pluginId, input.projectId, input.path, input.apiName, input.orgAlias, input.scope, presetsEnabled, reload]);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setDiscoveryError('');
    const load = () => {
      if (input.source === undefined && !input.path) { setFields([]); setLoading(false); return; }
      void callPluginRpc(input.pluginId, 'agentPreview.context', { projectId: input.projectId,
        ...(input.source !== undefined ? { source: input.source } : { path: input.path })
      }).then(result => {
        if (cancelled) return;
        const row = result as { ok?: boolean; fields?: PreviewContextField[]; error?: string } | undefined;
        if (row?.ok && Array.isArray(row.fields)) {
          setFields(row.fields);
          // Saved declarations remain visible for review if the script changed.
          if (!selectedRef.current) setEntries(prev => Object.fromEntries(Object.entries(prev).filter(([name, entry]) => !fields.some(f => f.name === name) || row.fields!.some(f => f.name === name && f.type === entry.type))));
        } else if (row?.error) setDiscoveryError(row.error);
      }).catch(error => { if (!cancelled) setDiscoveryError(error instanceof Error ? error.message : String(error)); })
        .finally(() => { if (!cancelled) setLoading(false); });
    };
    const timer = discoveryScope.current === input.scope ? setTimeout(load, 150) : undefined;
    discoveryScope.current = input.scope;
    if (timer === undefined) load();
    return () => { cancelled = true; clearTimeout(timer); };
    // fields is the previous discovery snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input.pluginId, input.projectId, input.path, input.source, input.scope]);
  const allFields = useMemo(() => {
    const rows = [...fields, ...manual.filter(f => !fields.some(d => d.name === f.name))];
    for (const f of selected?.fields ?? []) if (Object.hasOwn(entries, f.name) && !rows.some(r => r.name === f.name)) rows.push(f);
    return rows;
  }, [fields, manual, entries, selected]);
  const parsed = useMemo(() => validateContextEntries(entries), [entries]);
  const compatibility = useMemo(() => selected ? presetCompatibility(fields, selected.fields, Object.entries(entries).map(([name, e]) => ({ name, type: e.type, value: null }))) : {}, [fields, selected, entries]);
  const fieldErrors = { ...parsed.fieldErrors, ...compatibility };
  const error = parsed.errors[0] || Object.values(fieldErrors)[0] || '';
  const values = error ? [] : parsed.values;
  const edited = selected ? Boolean(error) || !sameContext(values, selected.values) : Object.keys(entries).length > 0;
  const presetIdentity: AppliedContextPreset | null = selected ? { id: selected.id, name: selected.name, revision: selected.revision, edited } : null;
  const adopt = (values: PreviewContextVariable[]) => {
    const rows = parsePreviewContext(values);
    setSelected(null); setUndo(null); setTouched({}); setReviewErrors(false); setAgentSet({});
    setManual(rows.filter(r => !fields.some(f => f.name === r.name)).map(r => ({ name: r.name, label: r.name, type: r.type })));
    setEntries(toEntries(rows));
  };
  const checkpoint = () => setUndo(structuredClone({ entries, manual, selected, touched, reviewErrors }));
  const loadPreset = (preset: ContextPreset | null) => {
    checkpoint(); setSelected(preset ? structuredClone(preset) : null); setPresetError(''); setTouched({}); setReviewErrors(false); setAgentSet({});
    setManual(preset?.fields.filter(f => !f.declared) ?? []);
    setEntries(toEntries(preset?.values ?? []));
  };
  const savePreset = async (name: string, update = false): Promise<boolean> => {
    if (error || !presetScope || saving) return false;
    const scope = input.scope;
    const owner = generation.current;
    const savedValues = parsePreviewContext(values);
    const definitions = allFields.filter(f => savedValues.some(v => v.name === f.name)).map(f => ({ ...f, declared: fields.some(d => d.name === f.name) }));
    setSaving(true); setPresetError('');
    try {
      const result = await callPluginRpc(input.pluginId, 'agentPreview.presets.save', {
        projectId: input.projectId, path: input.path, apiName: input.apiName, orgAlias: input.orgAlias, expectedScope: presetScope,
        name, values: savedValues, fields: definitions, ...(update && selected ? { id: selected.id, expectedRevision: selected.revision } : {})
      }) as { ok?: boolean; preset?: ContextPreset; error?: string };
      if (scope !== activeScope.current || owner !== generation.current) return false;
      if (!result?.ok || !result.preset) throw Error(result?.error || 'Preset could not be saved.');
      const saved = result.preset;
      setPresets(prev => [...prev.filter(p => p.id !== saved.id), saved]); setSelected(saved); return true;
    } catch (e) { if (scope === activeScope.current && owner === generation.current) setPresetError((e as Error).message); return false; }
    finally { if (scope === activeScope.current && owner === generation.current) setSaving(false); }
  };
  /** context.set from an agent: a preset, or values that replace (or, with merge, join) the current overrides. The person reviews them before a run. */
  const applyAgent = (input: { preset?: ContextPreset; values?: PreviewContextVariable[]; merge?: boolean }) => {
    if (input.preset) {
      loadPreset(input.preset);
      setAgentSet(Object.fromEntries(input.preset.values.map(v => [v.name, true as const])));
    } else {
      const rows = parsePreviewContext(input.values ?? []);
      checkpoint(); setSelected(null); setTouched({}); setReviewErrors(false);
      setManual(prev => [...(input.merge ? prev : []), ...rows.filter(r => !fields.some(f => f.name === r.name) && !(input.merge && prev.some(m => m.name === r.name))).map(r => ({ name: r.name, label: r.name, type: r.type }))]);
      setEntries(prev => ({ ...(input.merge ? prev : {}), ...toEntries(rows) }));
      setAgentSet(prev => ({ ...(input.merge ? prev : {}), ...Object.fromEntries(rows.map(r => [r.name, true as const])) }));
    }
    setTab('context');
  };
  return { id, scope: input.scope, agentSet, applyAgent, clearAgent: (name: string) => setAgentSet(prev => { if (!prev[name]) return prev; const next = { ...prev }; delete next[name]; return next; }), fields: allFields, entries, setEntries, manual, setManual, applied, appliedPreset, presetIdentity,
    markApplied: (v: PreviewContextVariable[], preset = presetIdentity) => { setApplied(parsePreviewContext(v)); setAppliedPreset(preset ? structuredClone(preset) : null); },
    loading, discoveryError, setup, setSetup, tab, setTab, values, error, fieldErrors, compatibilityErrors: compatibility, aggregateErrors: parsed.errors, adopt,
    touched, touch: (name: string) => setTouched(prev => ({ ...prev, [name]: true })), revealErrors: () => setReviewErrors(true), reviewErrors,
    changed: applied !== null && (Boolean(error) || !sameContext(applied, values)), count: Object.keys(entries).length,
    presetsEnabled, presets, selected, edited, presetScope, orgLabel, presetError, presetLoading, saving, savePreset,
    needsReview: Object.keys(compatibility).length > 0, reloadPresets: () => setReload(n => n + 1), loadPreset,
    reset: () => { checkpoint(); setEntries({}); setAgentSet({}); },
    canUndo: undo !== null, undo: () => { if (!undo) return; setEntries(undo.entries); setManual(undo.manual); setSelected(undo.selected); setTouched(undo.touched); setReviewErrors(undo.reviewErrors); setUndo(null); }
  };
}
export type PreviewContextState = ReturnType<typeof usePreviewContext>;
