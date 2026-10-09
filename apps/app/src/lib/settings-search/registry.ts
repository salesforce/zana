import { SETTINGS_GROUPS, SETTINGS_SECTIONS, SETTINGS_SUBSECTIONS } from '@/views/settings/settings-navigation';
import type { SettingsSearchEntry, SettingsSearchProvider } from './types';

// Lazy-load constraint: this module (and everything under settings-search/) must
// never import a settings VIEW module. settings-navigation.ts is the light nav
// registry the rail already depends on.

type EntryModule = { default?: readonly SettingsSearchEntry[]; entries?: readonly SettingsSearchEntry[] };

/** Flatten glob-collected page modules (`default` or `entries` export) in path order. */
export function collectEntryModules(modules: Record<string, EntryModule>): SettingsSearchEntry[] {
  const out: SettingsSearchEntry[] = [];
  for (const path of Object.keys(modules).sort()) {
    const mod = modules[path];
    out.push(...(mod.entries ?? mod.default ?? []));
  }
  return out;
}

/** Section + subsection entries derived from the nav registry, never duplicated. */
export function deriveNavEntries(): SettingsSearchEntry[] {
  const groupLabel = new Map(SETTINGS_GROUPS.map((g) => [g.id as string, g.label]));
  const out: SettingsSearchEntry[] = [];
  for (const section of SETTINGS_SECTIONS) {
    out.push({
      id: `${section.id}.section`,
      section: section.id,
      label: section.label,
      help: section.desc,
      keywords: [groupLabel.get(section.group) ?? section.group],
      kind: 'section'
    });
    for (const sub of SETTINGS_SUBSECTIONS[section.id] ?? []) {
      out.push({
        id: `${section.id}.${sub.id}`,
        section: section.id,
        anchor: sub.id,
        label: sub.label,
        kind: 'subsection'
      });
    }
  }
  return out;
}

// Later page units only ADD files under ./entries/; nothing else is edited.
const pageModules = import.meta.glob<EntryModule>('./entries/*.ts', { eager: true });

/**
 * Derived entries come first (nav order), but a page entry that describes the
 * same block wins: a derived SUBSECTION is dropped when a page entry in the same
 * section has the same title, so a title never shows twice. Derived section
 * entries stay: they are the page itself.
 */
export function mergeStaticEntries(
  derived: readonly SettingsSearchEntry[],
  page: readonly SettingsSearchEntry[]
): SettingsSearchEntry[] {
  const titled = new Set(page.map((e) => `${e.section}|${e.label.trim().toLowerCase()}`));
  const kept = derived.filter((e) => e.kind !== 'subsection' || !titled.has(`${e.section}|${e.label.trim().toLowerCase()}`));
  return [...kept, ...page];
}

let staticEntries: readonly SettingsSearchEntry[] | undefined;

/** Derived nav entries followed by every `entries/*.ts` page file. Stable identity. */
export function getStaticEntries(): readonly SettingsSearchEntry[] {
  staticEntries ??= mergeStaticEntries(deriveNavEntries(), collectEntryModules(pageModules));
  return staticEntries;
}

let providers: readonly SettingsSearchProvider[] = [];
let sourcesVersion = 0;
const sourcesListeners = new Set<() => void>();

function bumpSourcesVersion(): void {
  sourcesVersion += 1;
  for (const listener of sourcesListeners) listener();
}

/**
 * Register a runtime source. Returns an unregister function (release on shutdown).
 * Registration does not notify: the provider-array identity already invalidates
 * the corpus, and registering happens lazily on the first search (inside render),
 * where notifying subscribers would schedule an update mid-render.
 */
export function registerSettingsSearchProvider(provider: SettingsSearchProvider): () => void {
  providers = [...providers, provider];
  return () => {
    providers = providers.filter((p) => p !== provider);
  };
}

/** New array identity on every (un)registration. */
export function getSettingsSearchProviders(): readonly SettingsSearchProvider[] {
  return providers;
}

/**
 * An ASYNC source calls this when its data lands (plugin settings fetched), so an
 * open search re-ranks through `subscribeSettingsSearchSources`. Synchronous store
 * data needs no signal: providers expose it through `revision` instead.
 */
export function notifySettingsSearchSourcesChanged(): void {
  bumpSourcesVersion();
}

export function getSettingsSearchSourcesVersion(): number {
  return sourcesVersion;
}

/** `useSyncExternalStore`-shaped subscription to source changes. */
export function subscribeSettingsSearchSources(listener: () => void): () => void {
  sourcesListeners.add(listener);
  return () => {
    sourcesListeners.delete(listener);
  };
}
