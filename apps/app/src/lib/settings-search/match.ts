import { typoDistance, typoMaxEdits } from '@zana-ai/zcc-fuzzy-match';
import { fuzzyScore } from '../fuzzy';
import { normalize, type Corpus, type CorpusEntry } from './corpus';
import type { SettingsMatchTier, SettingsSearchHit, SettingsSnippet } from './types';

export const SETTINGS_SEARCH_MAX_RESULTS = 60;
export const SETTINGS_SEARCH_QUERY_MAX_LENGTH = 256;
export const SNIPPET_RADIUS = 40;
export const VALUE_DISPLAY_MAX_CHARS = 80;

/** Design 3.2 field weights (before the tier multiplier). */
export const FIELD_WEIGHT = {
  labelExact: 10,
  labelPrefix: 6,
  labelSubstring: 4,
  breadcrumb: 3,
  keywords: 3,
  options: 2,
  value: 2,
  help: 1,
  wordBoundaryBonus: 1
} as const;

export const TIER_MULTIPLIER: Record<SettingsMatchTier, number> = { 1: 1.0, 2: 0.6, 3: 0.4 };

const MIN_FUZZY_LENGTH = 3;

interface WordMatch {
  tier: SettingsMatchTier;
  score: number;
  valueHit: boolean;
}

function boundaryBonus(text: string, at: number): number {
  return at === 0 || !/[\p{L}\p{N}]/u.test(text[at - 1]) ? FIELD_WEIGHT.wordBoundaryBonus : 0;
}

function substringScore(text: string, word: string, weight: number): number {
  const at = text.indexOf(word);
  return at === -1 ? 0 : weight + boundaryBonus(text, at);
}

function listSubstringScore(list: readonly string[], word: string, weight: number): number {
  let best = 0;
  for (const item of list) best = Math.max(best, substringScore(item, word, weight));
  return best;
}

function isSubsequence(word: string, text: string): boolean {
  let at = 0;
  for (let i = 0; i < text.length && at < word.length; i += 1) {
    if (text[i] === word[at]) at += 1;
  }
  return at === word.length;
}

/** Letters-in-order via the shared fzf engine; the cheap subsequence test gates the (costly) call. */
function inOrder(text: string, word: string): boolean {
  return isSubsequence(word, text) && fuzzyScore(text, word) !== null;
}

function tier1(ce: CorpusEntry, word: string): WordMatch | null {
  let score = 0;
  if (ce.label === word) {
    score = FIELD_WEIGHT.labelExact;
  } else {
    const at = ce.label.indexOf(word);
    if (at !== -1) {
      score = (at === 0 ? FIELD_WEIGHT.labelPrefix : FIELD_WEIGHT.labelSubstring) + boundaryBonus(ce.label, at);
    }
  }
  score = Math.max(
    score,
    substringScore(ce.breadcrumb, word, FIELD_WEIGHT.breadcrumb),
    listSubstringScore(ce.keywords, word, FIELD_WEIGHT.keywords),
    listSubstringScore(ce.options, word, FIELD_WEIGHT.options),
    substringScore(ce.help, word, FIELD_WEIGHT.help)
  );
  const value = substringScore(ce.value, word, FIELD_WEIGHT.value);
  if (value === 0 && score === 0) return null;
  return { tier: 1, score: Math.max(score, value), valueHit: value > 0 };
}

/** Label, breadcrumb, keywords, options only: help text and paths are too noisy for letters-in-order. */
function tier2(ce: CorpusEntry, word: string): WordMatch | null {
  if (word.length < MIN_FUZZY_LENGTH) return null;
  let weight = 0;
  if (inOrder(ce.label, word)) weight = FIELD_WEIGHT.labelSubstring;
  else if (inOrder(ce.breadcrumb, word)) weight = FIELD_WEIGHT.breadcrumb;
  else if (ce.keywords.some((k) => inOrder(k, word))) weight = FIELD_WEIGHT.keywords;
  else if (ce.options.some((o) => inOrder(o, word))) weight = FIELD_WEIGHT.options;
  return weight ? { tier: 2, score: weight * TIER_MULTIPLIER[2], valueHit: false } : null;
}

function anyIn(words: readonly string[], near: ReadonlySet<string>): boolean {
  for (const w of words) if (near.has(w)) return true;
  return false;
}

function tier3(ce: CorpusEntry, near: ReadonlySet<string>): WordMatch | null {
  if (near.size === 0) return null;
  const w = ce.words;
  const valueHit = anyIn(w.value, near);
  let weight = 0;
  if (anyIn(w.label, near)) weight = FIELD_WEIGHT.labelSubstring;
  else if (anyIn(w.breadcrumb, near) || anyIn(w.keywords, near)) weight = FIELD_WEIGHT.keywords;
  else if (anyIn(w.options, near) || valueHit) weight = FIELD_WEIGHT.options;
  else if (anyIn(w.help, near)) weight = FIELD_WEIGHT.help;
  return weight ? { tier: 3, score: weight * TIER_MULTIPLIER[3], valueHit } : null;
}

/** Corpus words within the typo budget of `word` (empty for words under 4 characters). */
export function nearWords(vocab: ReadonlySet<string>, word: string): Set<string> {
  const near = new Set<string>();
  const max = typoMaxEdits(word.length);
  if (max === 0) return near;
  for (const candidate of vocab) {
    if (candidate === word || Math.abs(candidate.length - word.length) > max) continue;
    if (typoDistance(word, candidate, max) <= max) near.add(candidate);
  }
  return near;
}

function matchWord(ce: CorpusEntry, word: string, near: () => ReadonlySet<string>): WordMatch | null {
  return tier1(ce, word) ?? tier2(ce, word) ?? tier3(ce, near());
}

function wordRanges(text: string, word: string, near: ReadonlySet<string>): Array<[number, number]> {
  const direct = text.indexOf(word);
  if (direct !== -1) return [[direct, direct + word.length]];
  const ranges: Array<[number, number]> = [];
  if (near.size === 0) return ranges;
  for (const m of text.matchAll(/[\p{L}\p{N}]+/gu)) {
    if (near.has(m[0])) {
      ranges.push([m.index, m.index + m[0].length]);
      break;
    }
  }
  return ranges;
}

/** Sorted, non-overlapping ranges: words like `auto` and `automatic` overlap in the same text. */
export function mergeRanges(ranges: ReadonlyArray<readonly [number, number]>): Array<[number, number]> {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out: Array<[number, number]> = [];
  for (const [start, end] of sorted) {
    const prev = out[out.length - 1];
    if (prev && start <= prev[1]) prev[1] = Math.max(prev[1], end);
    else out.push([start, end]);
  }
  return out;
}

function buildSnippet(ce: CorpusEntry, words: readonly string[], nears: readonly ReadonlySet<string>[]): SettingsSnippet | undefined {
  if (!ce.help) return undefined;
  const hits = mergeRanges(words.flatMap((w, i) => wordRanges(ce.help, w, nears[i])));
  if (hits.length === 0) return undefined;
  const start = Math.max(0, hits[0][0] - SNIPPET_RADIUS);
  const end = Math.min(ce.help.length, hits[0][1] + SNIPPET_RADIUS);
  const lead = start > 0 ? '…' : '';
  const tail = end < ce.help.length ? '…' : '';
  const ranges = hits
    .filter(([s, e]) => s >= start && e <= end)
    .map(([s, e]): [number, number] => [s - start + lead.length, e - start + lead.length]);
  return { text: `${lead}${ce.helpPlain.slice(start, end)}${tail}`, ranges };
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** AND across query words; tier 1 always outranks 2 and 3, then score, then settings order. */
export function matchCorpus(corpus: Corpus, query: string, limit = SETTINGS_SEARCH_MAX_RESULTS): SettingsSearchHit[] {
  const normalized = normalize(query);
  if (!normalized || normalized.length > SETTINGS_SEARCH_QUERY_MAX_LENGTH) return [];
  const words = [...new Set(normalized.split(' '))];
  const cap = Number.isFinite(limit) ? Math.max(0, Math.min(Math.floor(limit), SETTINGS_SEARCH_MAX_RESULTS)) : SETTINGS_SEARCH_MAX_RESULTS;
  if (cap === 0) return [];

  const nearCache = new Map<string, Set<string>>();
  const nearFor = (word: string): ReadonlySet<string> => {
    let near = nearCache.get(word);
    if (!near) {
      near = nearWords(corpus.vocab, word);
      nearCache.set(word, near);
    }
    return near;
  };

  const found: Array<{ ce: CorpusEntry; tier: SettingsMatchTier; score: number; valueHit: boolean }> = [];
  for (const ce of corpus.entries) {
    let tier: SettingsMatchTier = 1;
    let score = 0;
    let valueHit = false;
    let ok = true;
    for (const word of words) {
      const m = matchWord(ce, word, () => nearFor(word));
      if (!m) {
        ok = false;
        break;
      }
      if (m.tier > tier) tier = m.tier;
      score += m.score;
      valueHit ||= m.valueHit;
    }
    if (ok) found.push({ ce, tier, score, valueHit });
  }

  found.sort((a, b) => a.tier - b.tier || b.score - a.score || a.ce.rank - b.ce.rank || (a.ce.entry.id < b.ce.entry.id ? -1 : 1));

  return found.slice(0, cap).map(({ ce, tier, score, valueHit }) => {
    const hit: SettingsSearchHit = { entry: ce.entry, breadcrumb: ce.breadcrumbPlain, score, tier };
    const snippet = buildSnippet(ce, words, words.map(nearFor));
    if (snippet) hit.snippet = snippet;
    if (valueHit) hit.matchedValue = truncate(ce.valuePlain, VALUE_DISPLAY_MAX_CHARS);
    return hit;
  });
}
