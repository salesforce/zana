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

/** Compact letter-skipping (`sn5` → `Sonnet 5`) only for short queries. */
const LETTER_SKIP_QUERY_MAX = 4;

export function buildFuzzyRegex(query: string): RegExp {
  const pattern = query
    .split('')
    .map((char) => char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(pattern, 'i');
}

function searchSegments(haystack: string): string[] {
  return haystack.split(/[^a-z0-9]+/u).filter(Boolean);
}

/**
 * Score a catalog row for a picker query. Letter-skipping (`o.*p.*e.*n.*a.*i`)
 * is too loose on slash-separated ids: `openai` must not match
 * `openrouter/rekaai/reka-flash-3`.
 */
export function modelQueryScore(haystack: string, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 1;
  const hay = haystack.toLowerCase();
  if (hay === q) return 6;
  if (hay.startsWith(q)) return 5;
  const segments = searchSegments(hay);
  if (segments.some((segment) => segment === q)) return 4;
  if (hay.includes(q)) return 3;
  if (segments.some((segment) => segment.startsWith(q))) return 3;
  const compactHay = hay.replace(/[^a-z0-9]+/gu, '');
  const compactQ = q.replace(/[^a-z0-9]+/gu, '');
  if (compactQ && compactHay.includes(compactQ)) return 2;
  if (q.length <= LETTER_SKIP_QUERY_MAX && buildFuzzyRegex(q).test(hay)) return 1;
  return 0;
}

export function matchesModelQuery(haystack: string, query: string): boolean {
  return modelQueryScore(haystack, query) > 0;
}

export function fuzzyFilter<T>(
  options: readonly T[],
  normalizedQuery: string,
  getText: (option: T) => string
): readonly T[] {
  if (!normalizedQuery) return options;
  return options
    .map((option, index) => ({
      option,
      index,
      score: modelQueryScore(getText(option), normalizedQuery)
    }))
    .filter((row) => row.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((row) => row.option);
}

export function modelSearchText(option: ModelPickerOption, providerId: string): string {
  return `${stripModelBrandPrefix(option.label, providerId)} ${option.routeProviderId ?? ''} ${option.value}`;
}

export type ModelNavRow =
  | { kind: 'model'; option: ModelPickerOption }
  | { kind: 'more-toggle' };

export function pinSelectedMoreModels(
  modelOptions: readonly ModelPickerOption[],
  moreModelOptions: readonly ModelPickerOption[],
  selected: string
): { modelOptions: readonly ModelPickerOption[]; moreModelOptions: readonly ModelPickerOption[] } {
  if (!selected || modelOptions.some((option) => option.value === selected)) {
    return { modelOptions, moreModelOptions };
  }
  const pinned = moreModelOptions.find((option) => option.value === selected);
  if (!pinned) return { modelOptions, moreModelOptions };
  return {
    modelOptions: [...modelOptions, pinned],
    moreModelOptions: moreModelOptions.filter((option) => option.value !== selected)
  };
}

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
