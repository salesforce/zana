import type { PreviewContextField, PreviewContextVariable } from './preview-context.js';

export const CONTEXT_PRESETS_CHANGED = 'salesforce.context-presets.changed';
export const CONTEXT_PRESET_LIMITS = { perAgent: 20, perProject: 100, bytes: 4_000_000 } as const;
export type PresetField = PreviewContextField & { declared: boolean };
export interface ContextPreset {
  id: string;
  name: string;
  revision: number;
  updatedAt: number;
  values: PreviewContextVariable[];
  fields: PresetField[];
  /** 'agent' when a thread saved this revision through sf_workbench contextPresets.save. */
  savedBy?: 'agent';
}
export interface ContextPresetList {
  ok: boolean;
  presets?: ContextPreset[];
  scopeKey?: string;
  orgLabel?: string;
  error?: string;
}
export interface AppliedContextPreset { id: string; name: string; revision: number; edited: boolean }

/** Ordering of overrides is not part of their meaning. */
export function sameContext(a: PreviewContextVariable[], b: PreviewContextVariable[]): boolean {
  const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, stable(v)])) : value;
  const canonical = (values: PreviewContextVariable[]) => JSON.stringify(stable([...values].sort((x, y) => x.name.localeCompare(y.name))));
  return canonical(a) === canonical(b);
}

export function presetCompatibility(fields: PreviewContextField[], saved: PresetField[], values: PreviewContextVariable[]): Record<string, string> {
  const errors: Record<string, string> = Object.create(null);
  for (const row of values) {
    const old = saved.find(f => f.name === row.name);
    const current = fields.find(f => f.name === row.name);
    if (old?.declared && !current) errors[row.name] = 'This variable is no longer declared. Remove this override before starting.';
    else if (current && current.type !== row.type) errors[row.name] = `This variable is now ${current.type}. Remove this override and enter a new value.`;
  }
  return errors;
}
