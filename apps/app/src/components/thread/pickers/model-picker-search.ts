import type { ModelPickerOption } from './model-picker-option.js';
import { stripModelBrandPrefix } from './model-brand-prefix.js';

export interface ModelLabelParts {
  base: string;
  tag: string | null;
}

/** Splits a trailing parenthetical off a model label (e.g. "Opus 4.8 (1M)"). */
export function splitModelLabelTag(label: string): ModelLabelParts {
  const match = label.match(/^(.*\S)\s*\(([^()]+)\)$/u);
  if (!match) return { base: label, tag: null };
  return { base: match[1]!, tag: match[2]! };
}

export function buildFuzzyRegex(query: string): RegExp {
  const pattern = query
    .split('')
    .map((char) => char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(pattern, 'i');
}

export function fuzzyFilter<T>(
  options: readonly T[],
  normalizedQuery: string,
  getText: (option: T) => string
): readonly T[] {
  if (!normalizedQuery) return options;
  const regex = buildFuzzyRegex(normalizedQuery);
  return options.filter((option) => regex.test(getText(option)));
}

export function modelSearchText(option: ModelPickerOption, providerId: string): string {
  return `${stripModelBrandPrefix(option.label, providerId)} ${option.routeProviderId ?? ''} ${option.value}`;
}

export type ModelNavRow =
  | { kind: 'model'; option: ModelPickerOption }
  | { kind: 'more-toggle' };

export function buildModelNavRows({
  modelOptions,
  moreModelOptions,
  isSearching
}: {
  modelOptions: readonly ModelPickerOption[];
  moreModelOptions: readonly ModelPickerOption[];
  isSearching: boolean;
}): ModelNavRow[] {
  const rows: ModelNavRow[] = modelOptions.map((option) => ({ kind: 'model', option }));
  if (moreModelOptions.length === 0) return rows;
  if (isSearching) {
    for (const option of moreModelOptions) rows.push({ kind: 'model', option });
    return rows;
  }
  rows.push({ kind: 'more-toggle' });
  return rows;
}
