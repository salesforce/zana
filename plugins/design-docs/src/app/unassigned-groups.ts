import type { DesignDocSummary } from '../shared/contract.js';
import type { UnassignedProject } from './api.js';

/** Longest peer-supplied label, in code points (mirrors the server cap). */
export const MAX_GROUP_LABEL = 80;
export const UNNAMED_PROJECT = 'Unnamed project';
export const OTHER_LABEL = 'Other';
export const OTHER_KEY = 'unassigned-other';
export const GROUP_KEY_PREFIX = 'unassigned:';

export interface UnassignedGroup {
  /** Stable collapse key; never contains anything rendered. */
  key: string;
  /** Display label, sanitized, bounded and made unique. Never the raw foreign id. */
  label: string;
  /** The local Project the server suggests mapping to; shown only in a chip and the map shortcut. */
  suggestedName: string | null;
  suggestionBasis: 'tag' | 'name' | null;
  /** Opaque id for the mapping dialog; null for the trailing "Other" group. */
  foreignProjectId: string | null;
  /** The doc list hit its cap, so this group may be partial. */
  capped: boolean;
  /** True while label metadata is loading: the UI shows a skeleton instead of the label. */
  pending: boolean;
  docs: DesignDocSummary[];
}

export type LabelSource = 'ready' | 'loading' | 'failed';

export interface GroupOptions {
  /** Doc list cap; a list that reaches it may be partial. */
  cap: number;
  /** State of the `unassignedProjects` label source. Defaults to ready. */
  labels?: LabelSource;
}

// Invisible and format characters a peer could use to spoof or hide text (mirrors the server's cleanLabel).
// eslint-disable-next-line no-control-regex
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u206f\u2800\u3164\ufe00-\ufe0f\ufeff\u{e0000}-\u{e007f}\u{e0100}-\u{e01ef}]/gu;
const COMBINING_RUN = /(\p{M}{3})\p{M}+/gu;

/** Peer text made safe to render: invisible characters removed, combining runs and length capped, blank as null. */
export function cleanPeerText(value: string | null | undefined): string | null {
  const cleaned = (value ?? '').replace(INVISIBLE, '').replace(COMBINING_RUN, '$1').trim();
  if (!cleaned) return null;
  const points = Array.from(cleaned);
  return (points.length > MAX_GROUP_LABEL ? points.slice(0, MAX_GROUP_LABEL).join('').trimEnd() : cleaned) || null;
}

/** The most common Cyrillic and Greek letters that look like Latin ones. */
const CONFUSABLE: Record<string, string> = {
  а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', у: 'y', х: 'x', і: 'i', ј: 'j', ѕ: 's', һ: 'h', ԁ: 'd', ԛ: 'q', ԝ: 'w',
  ο: 'o', ν: 'v', α: 'a', ε: 'e', ι: 'i', κ: 'k', ρ: 'p', τ: 't', υ: 'u', χ: 'x'
};

/** Comparison form of a label: NFKC, case, whitespace and common lookalike letters folded. */
export function foldLabel(value: string): string {
  const base = value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
  let out = '';
  for (const ch of base) out += CONFUSABLE[ch] ?? ch;
  return out;
}

/** Label for a foreign project: the sender's name, else its first doc title; a suggested Project never becomes the label. */
export function groupLabel(
  item: Pick<UnassignedProject, 'senderName' | 'sampleTitles'> & Partial<Pick<UnassignedProject, 'senderTag' | 'suggestion'>>,
  fallbackTitle?: string
): { label: string; suggestedName: string | null } {
  const label = cleanPeerText(item.senderName) ?? cleanPeerText(item.sampleTitles[0]) ?? cleanPeerText(fallbackTitle) ?? UNNAMED_PROJECT;
  return { label, suggestedName: cleanPeerText(item.suggestion?.name) };
}

/** Heading for a foreign project in the mapping dialog: the sender's name, else its first doc title; ids are never shown. */
export function headingLabel(item: Pick<UnassignedProject, 'senderName' | 'sampleTitles'>): string {
  return groupLabel(item).label;
}

interface Draft {
  id: string;
  label: string;
  tag: string | null;
  suggestedName: string | null;
  basis: 'tag' | 'name' | null;
  docs: DesignDocSummary[];
  newest: number;
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Group the unassigned doc list into one group per foreign project. Membership comes from the docs only;
 * `projects` supplies labels and is joined by id. Docs without a usable id go to a trailing "Other" group.
 */
export function buildUnassignedGroups(
  docs: DesignDocSummary[],
  projects: UnassignedProject[],
  localProjectNames: string[],
  opts: GroupOptions
): UnassignedGroup[] {
  const labels = opts.labels ?? 'ready';
  const capped = opts.cap > 0 && docs.length >= opts.cap;
  const meta = new Map<string, UnassignedProject>();
  if (labels === 'ready') for (const project of projects) if (typeof project.foreignProjectId === 'string') meta.set(project.foreignProjectId, project);

  const byId = new Map<string, DesignDocSummary[]>();
  const other: DesignDocSummary[] = [];
  for (const doc of docs) {
    const id = doc.foreignProjectId;
    if (typeof id !== 'string' || id === '') {
      other.push(doc);
      continue;
    }
    const list = byId.get(id) ?? [];
    list.push(doc);
    byId.set(id, list);
  }

  const drafts: Draft[] = [];
  for (const [id, members] of byId) {
    const project = meta.get(id);
    const named = project ? groupLabel(project, members[0]?.title) : { label: cleanPeerText(members[0]?.title) ?? UNNAMED_PROJECT, suggestedName: null };
    drafts.push({
      id,
      label: named.label,
      tag: cleanPeerText(project?.senderTag),
      suggestedName: named.suggestedName,
      basis: named.suggestedName ? project?.suggestion?.basis ?? null : null,
      docs: members,
      newest: members.reduce((max, doc) => Math.max(max, doc.updatedAt), 0)
    });
  }

  if (labels === 'ready') {
    // Collisions are judged over every known label (the unfiltered project list included), so a suffix
    // does not change with the search text, a sync reorder or the doc window.
    const universe = new Map<string, string>();
    for (const [id, project] of meta) universe.set(id, foldLabel(groupLabel(project).label));
    for (const draft of drafts) universe.set(draft.id, foldLabel(draft.label));
    const local = new Set(localProjectNames.map(foldLabel));
    for (const draft of drafts) if (draft.suggestedName) local.add(foldLabel(draft.suggestedName));
    const sorted = [...universe.keys()].sort(compare);
    const rank = (id: string, fold: string) => sorted.filter((other) => universe.get(other) === fold).indexOf(id) + 1;
    const shared = (fold: string) => sorted.filter((id) => universe.get(id) === fold).length;
    const collides = (draft: Draft) => local.has(universe.get(draft.id)!) || shared(universe.get(draft.id)!) > 1;
    const colliding = drafts.filter(collides);
    const tagged = new Map<string, number>();
    for (const draft of colliding) {
      if (draft.tag) {
        const key = foldLabel(`${draft.label} (${draft.tag})`);
        tagged.set(key, (tagged.get(key) ?? 0) + 1);
      }
    }
    for (const draft of colliding) {
      const withTag = draft.tag ? `${draft.label} (${draft.tag})` : null;
      const unique = withTag !== null && tagged.get(foldLabel(withTag)) === 1 && !local.has(foldLabel(withTag));
      draft.label = unique ? withTag : `${draft.label} #${rank(draft.id, universe.get(draft.id)!)}`;
    }
  }

  drafts.sort((a, b) => b.newest - a.newest || compare(a.label, b.label) || compare(a.id, b.id));
  const out: UnassignedGroup[] = drafts.map((draft) => ({
    key: `${GROUP_KEY_PREFIX}${draft.id}`,
    label: draft.label,
    suggestedName: draft.suggestedName,
    suggestionBasis: draft.basis,
    foreignProjectId: draft.id,
    capped,
    pending: labels === 'loading',
    docs: draft.docs
  }));
  if (other.length) {
    out.push({ key: OTHER_KEY, label: OTHER_LABEL, suggestedName: null, suggestionBasis: null, foreignProjectId: null, capped, pending: false, docs: other });
  }
  return out;
}
