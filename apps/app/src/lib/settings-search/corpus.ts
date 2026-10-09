import { SETTINGS_GROUPS, SETTINGS_SECTIONS, SETTINGS_SUBSECTIONS } from '@/views/settings/settings-navigation';
import { warnSettingsSearchOnce } from './diagnostics';
import { mayIndexValue } from './secrets';
import { getSettingsSearchProviders, getSettingsSearchSourcesVersion, getStaticEntries } from './registry';
import type { SettingsSearchEntry, SettingsSearchProvider, SettingsValueSnapshot } from './types';

export const VALUE_INDEX_MAX_CHARS = 200;

const MARKS = /\p{M}/u;
const ONLY_MARKS = /^\p{M}+$/u;

/**
 * Lowercase + strip diacritics, one output UTF-16 unit per input unit so
 * offsets in folded text are valid offsets in the original (snippets rely on it).
 * A unit folds to its NFD base only when the rest of the decomposition is
 * combining marks (é → e); a decomposition into further letters (a Hangul
 * syllable into jamo) keeps the unit, so it never collapses to its first jamo.
 */
export function fold(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    const unit = text[i];
    const nfd = unit.normalize('NFD');
    const base = nfd.length > 1 && ONLY_MARKS.test(nfd.slice(1)) ? nfd[0] : unit;
    out += MARKS.test(base) ? unit : (base.toLowerCase()[0] ?? unit);
  }
  return out;
}

/** Canonical plain text: NFC, whitespace collapsed and trimmed. */
export function plain(text: string): string {
  return text.normalize('NFC').replace(/\s+/g, ' ').trim();
}

/** Normalised form used for matching: lowercase, no diacritics, single-spaced. */
export function normalize(text: string): string {
  return fold(plain(text));
}

export function tokenize(folded: string): string[] {
  return folded.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

export interface CorpusEntry {
  entry: SettingsSearchEntry;
  /** Section order first, then registration order: the stable tie-break. */
  rank: number;
  label: string;
  breadcrumb: string;
  breadcrumbPlain: string;
  help: string;
  helpPlain: string;
  keywords: string[];
  options: string[];
  value: string;
  valuePlain: string;
  words: {
    label: string[];
    breadcrumb: string[];
    keywords: string[];
    options: string[];
    value: string[];
    help: string[];
  };
}

export interface Corpus {
  entries: CorpusEntry[];
  /** Unique words across every field: the typo tier scans these, not the entries. */
  vocab: ReadonlySet<string>;
}

interface StaticPart {
  entries: CorpusEntry[];
  vocab: Set<string>;
}

const SECTION_RANK = new Map<string, number>(SETTINGS_SECTIONS.map((s, i) => [s.id, i]));
const SECTION_LABEL = new Map<string, string>(SETTINGS_SECTIONS.map((s) => [s.id, s.label]));
const GROUP_LABEL = new Map<string, string>(SETTINGS_GROUPS.map((g) => [g.id, g.label]));
const SECTION_GROUP = new Map<string, string>(SETTINGS_SECTIONS.map((s) => [s.id, s.group]));
const RANK_STRIDE = 1_000_000;

function breadcrumbFor(entry: SettingsSearchEntry): string {
  if (entry.section === 'project') return 'Project';
  const section = SECTION_LABEL.get(entry.section) ?? entry.section;
  if (entry.kind === 'section') return GROUP_LABEL.get(SECTION_GROUP.get(entry.section) ?? '') ?? section;
  const sub = subLabel(entry);
  return sub && entry.kind !== 'subsection' ? `${section} › ${sub}` : section;
}

function subLabel(entry: SettingsSearchEntry): string | undefined {
  return SETTINGS_SUBSECTIONS[entry.section]?.find((s) => s.id === entry.anchor)?.label;
}

function rankOf(entry: SettingsSearchEntry, index: number): number {
  return (SECTION_RANK.get(entry.section) ?? SECTION_RANK.size) * RANK_STRIDE + index;
}

function makeEntry(entry: SettingsSearchEntry, index: number): CorpusEntry {
  const breadcrumbPlain = breadcrumbFor(entry);
  const helpPlain = plain(entry.help ?? '');
  const label = normalize(entry.label);
  const breadcrumb = normalize(breadcrumbPlain);
  const help = fold(helpPlain);
  const keywords = (entry.keywords ?? []).map(normalize).filter(Boolean);
  const options = (entry.options ?? []).map(normalize).filter(Boolean);
  return {
    entry,
    rank: rankOf(entry, index),
    label,
    breadcrumb,
    breadcrumbPlain,
    help,
    helpPlain,
    keywords,
    options,
    value: '',
    valuePlain: '',
    words: {
      label: tokenize(label),
      breadcrumb: tokenize(breadcrumb),
      keywords: keywords.flatMap(tokenize),
      options: options.flatMap(tokenize),
      value: [],
      help: tokenize(help)
    }
  };
}

function addVocab(vocab: Set<string>, ce: CorpusEntry): void {
  for (const list of Object.values(ce.words)) for (const w of list) vocab.add(w);
}

/** Read an entry's current value into a copy of its corpus row. Never throws. */
function withValue(ce: CorpusEntry, snapshot: SettingsValueSnapshot): CorpusEntry {
  if (!mayIndexValue(ce.entry)) return ce;
  let raw: string | readonly string[] | undefined;
  try {
    raw = ce.entry.value?.(snapshot);
  } catch (error) {
    warnSettingsSearchOnce(`value:${ce.entry.id}`, `value accessor for "${ce.entry.id}" failed; indexing it without its value`, error);
    return ce;
  }
  if (raw === undefined || raw === null) return ce;
  const joined = (Array.isArray(raw) ? raw.join(', ') : String(raw)).slice(0, VALUE_INDEX_MAX_CHARS);
  const valuePlain = plain(joined);
  if (!valuePlain) return ce;
  const value = fold(valuePlain);
  return { ...ce, value, valuePlain, words: { ...ce.words, value: tokenize(value) } };
}

const staticCache = new WeakMap<readonly SettingsSearchEntry[], StaticPart>();

function staticPartFor(entries: readonly SettingsSearchEntry[]): StaticPart {
  let part = staticCache.get(entries);
  if (!part) {
    const seen = new Set<string>();
    const rows: CorpusEntry[] = [];
    entries.forEach((entry, index) => {
      if (seen.has(entry.id)) return;
      seen.add(entry.id);
      rows.push(makeEntry(entry, index));
    });
    const vocab = new Set<string>();
    for (const row of rows) addVocab(vocab, row);
    part = { entries: rows, vocab };
    staticCache.set(entries, part);
  }
  return part;
}

let last:
  | {
      snapshot: SettingsValueSnapshot;
      entries: readonly SettingsSearchEntry[];
      providers: readonly SettingsSearchProvider[];
      sourcesVersion: number;
      revisions: ReadonlyArray<readonly unknown[]>;
      corpus: Corpus;
    }
  | undefined;

const NO_REVISION: readonly unknown[] = [];

function readRevisions(providers: readonly SettingsSearchProvider[]): Array<readonly unknown[]> {
  return providers.map((provider, index) => {
    try {
      return provider.revision?.() ?? NO_REVISION;
    } catch (error) {
      warnSettingsSearchOnce(`revision:${provider.name || index}`, `provider "${provider.name || index}" revision() failed`, error);
      return NO_REVISION;
    }
  });
}

function sameRevisions(a: ReadonlyArray<readonly unknown[]>, b: ReadonlyArray<readonly unknown[]>): boolean {
  return a.length === b.length && a.every((ra, i) => ra.length === b[i].length && ra.every((v, j) => Object.is(v, b[i][j])));
}

/**
 * Static text is normalised once per entries array; values and provider output
 * are re-derived only when the snapshot identity, the provider set, a provider's
 * `revision`, or the sources version (an async source landed) changes.
 */
export function buildCorpus(
  snapshot: SettingsValueSnapshot,
  entries: readonly SettingsSearchEntry[] = getStaticEntries(),
  providers: readonly SettingsSearchProvider[] = getSettingsSearchProviders()
): Corpus {
  const sourcesVersion = getSettingsSearchSourcesVersion();
  const revisions = readRevisions(providers);
  if (
    last &&
    last.snapshot === snapshot &&
    last.entries === entries &&
    last.providers === providers &&
    last.sourcesVersion === sourcesVersion &&
    sameRevisions(last.revisions, revisions)
  ) {
    return last.corpus;
  }
  const part = staticPartFor(entries);
  const seen = new Set(part.entries.map((r) => r.entry.id));
  const rows = part.entries.map((r) => withValue(r, snapshot));
  const vocab = new Set(part.vocab);
  rows.forEach((r, i) => {
    if (r !== part.entries[i]) for (const w of r.words.value) vocab.add(w);
  });

  let index = entries.length;
  for (const provider of providers) {
    let provided: readonly SettingsSearchEntry[] = [];
    try {
      provided = provider(snapshot);
    } catch (error) {
      // One broken source never blanks the rest.
      warnSettingsSearchOnce(`provider:${provider.name || providers.indexOf(provider)}`, `provider "${provider.name || providers.indexOf(provider)}" failed; skipping its results`, error);
      continue;
    }
    for (const entry of provided) {
      if (seen.has(entry.id)) continue;
      seen.add(entry.id);
      const row = withValue(makeEntry(entry, index), snapshot);
      index += 1;
      addVocab(vocab, row);
      rows.push(row);
    }
  }

  const corpus: Corpus = { entries: rows, vocab };
  last = { snapshot, entries, providers, sourcesVersion, revisions, corpus };
  return corpus;
}
