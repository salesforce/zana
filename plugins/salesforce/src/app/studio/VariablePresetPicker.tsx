import { useState } from 'react';
import { parsePreviewContext, type PreviewContextField, type PreviewContextVariable } from '../../../lib/preview-context.js';
import { presetCompatibility, sameContext, type ContextPreset } from '../../../lib/preview-context-preset-contract.js';

/** Applying a preset copies values; refreshing the catalogue never changes this setup. */
export function VariablePresetPicker({ presets, values, fields, custom, loading, error, onReload, onApply, defaultsLabel = 'Runtime defaults' }: {
  presets: ContextPreset[]; values: PreviewContextVariable[]; fields: PreviewContextField[];
  custom?: boolean; loading?: boolean; error?: string | null; onReload?(): void;
  onApply(values: PreviewContextVariable[]): void; defaultsLabel?: string;
}) {
  const [issue, setIssue] = useState('');
  const matching = !custom && presets.find(preset => sameContext(preset.values, values));
  return <div className="sf-variable-presets">
    <style>{`.sf-variable-presets{padding:14px;background:var(--sf-sunken);border:1px solid var(--sf-border);border-radius:8px;margin:14px 0}.sf-variable-presets label{display:flex;align-items:center;gap:12px;flex-wrap:wrap;font-size:12px;color:var(--sf-text)}.sf-variable-presets select{flex:1;min-width:140px;max-width:100%;padding:9px;border:1px solid var(--sf-border);border-radius:6px;background:var(--sf-bg);color:var(--sf-text);font:inherit}.sf-variable-presets p{font-size:11px;line-height:1.6;margin:8px 0 0;color:var(--sf-muted)}.sf-variable-presets p[role=alert]{color:var(--sf-danger)}`}</style>
    <label>Variable preset<select aria-label="Variable preset" disabled={loading || Boolean(error)} value={custom || values.length ? matching ? matching.id : '__custom' : ''} onChange={event => {
      setIssue('');
      if (!event.target.value) { onApply([]); return; }
      const preset = presets.find(row => row.id === event.target.value);
      if (!preset) { setIssue('This preset is unavailable. Reload presets and try again.'); return; }
      try {
        const values = parsePreviewContext(preset.values);
        const issue = Object.values(presetCompatibility(fields, preset.fields ?? [], values))[0];
        if (issue) throw Error(issue);
        onApply(values);
      } catch (error) { setIssue((error as Error).message); }
    }}><option value="">{defaultsLabel}</option>{(custom || values.length > 0) && !matching && <option value="__custom">Custom values</option>}{presets.map(preset => <option key={preset.id} value={preset.id}>{preset.name} · revision {preset.revision}</option>)}</select></label>
    <p>{loading ? 'Loading saved presets…' : 'Reuse presets saved in Preview or Role-play for this agent and org. Values are copied; edits here keep the saved preset unchanged.'}</p>
    {!loading && !error && !presets.length && <p>No saved presets yet. Save one in Preview → Context or Role-play → Setup → Initial variables.</p>}
    {(error || issue) && <p role="alert">{error || issue}{onReload && <button type="button" onClick={() => { setIssue(''); onReload(); }}>Reload presets</button>}</p>}
  </div>;
}
