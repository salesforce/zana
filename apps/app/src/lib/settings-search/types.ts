import type { AppConfig, ProjectSettings } from '@zana-ai/zcc-domain/product';
import type { SettingsTab } from '@/store';

/** One searchable thing on a Settings page. Static text only; values come from `value`. */
export interface SettingsSearchEntry {
  /** Stable, e.g. 'agents.auto-close-idle'; also the DOM target key. */
  id: string;
  section: SettingsTab | 'project';
  /** Existing settings-anchor-<id> (handles Harness tab switching). */
  anchor?: string;
  /** What the user sees as the control's name. */
  label: string;
  /** Plain-text help/description (JSX flattened by hand). */
  help?: string;
  /** Picklist / segmented-control option labels. */
  options?: readonly string[];
  /** Curated synonyms ("dark" -> theme). */
  keywords?: readonly string[];
  kind: 'section' | 'subsection' | 'setting' | 'action';
  /** Route to open instead of the Settings page (e.g. plugin settings live on the plugin page). */
  href?: string;
  /** Entry id of the gating toggle -> result says "Appears when ... is on". */
  dependsOn?: string;
  /** Container to expand before scrolling. */
  reveal?: 'advanced';
  /** Project-only visibility. */
  scope?: 'remote' | 'local';
  /**
   * Opt-in, pure read of the CURRENT value from a snapshot. Never set on
   * secret fields (see `secrets.ts`). Booleans should read `On` / `Off`; enums
   * their option label.
   */
  value?: (s: SettingsValueSnapshot) => string | readonly string[] | undefined;
}

/** Plain data the renderer already holds; the index never fetches values itself. */
export interface SettingsValueSnapshot {
  config: AppConfig;
  project?: { id: string; settings: ProjectSettings };
  machines?: readonly { id?: string; name: string; host?: string }[];
}

/**
 * Runtime sources (keyboard, harness, plugins, machines, catalogues). The
 * optional `revision` returns the identities of the data the provider reads
 * (cheap, no side effects); the corpus rebuilds when any of them changes, so a
 * provider stays fresh without subscribing to anything.
 *
 * Contract: return STABLE references (store arrays, snapshot objects, cached
 * maps) or primitives. Elements are compared with `Object.is`, so building a
 * fresh object or array inside `revision()` would defeat the memoisation and
 * rebuild the corpus on every search.
 */
export interface SettingsSearchProvider {
  (s: SettingsValueSnapshot): readonly SettingsSearchEntry[];
  revision?: () => readonly unknown[];
}

/** Highlight ranges are `[start, end)` offsets into `text`. */
export interface SettingsSnippet {
  text: string;
  ranges: Array<[number, number]>;
}

export type SettingsMatchTier = 1 | 2 | 3;

export interface SettingsSearchHit {
  entry: SettingsSearchEntry;
  /** `Section › Subsection`, shown under the label. */
  breadcrumb: string;
  score: number;
  /** Worst tier any query word needed: 1 exact/prefix/substring, 2 letters-in-order, 3 typo. */
  tier: SettingsMatchTier;
  /** Window around the first help-text hit. */
  snippet?: SettingsSnippet;
  /** Current value (truncated) when the query hit it: rendered as `Current: …`. */
  matchedValue?: string;
}

export interface SearchSettingsOptions {
  /** Max results; clamped to `SETTINGS_SEARCH_MAX_RESULTS`. */
  limit?: number;
  /** Test seams: override the static entries / providers. */
  entries?: readonly SettingsSearchEntry[];
  providers?: readonly SettingsSearchProvider[];
}
