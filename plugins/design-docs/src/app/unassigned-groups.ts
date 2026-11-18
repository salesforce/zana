import type { DesignDocSummary } from '../shared/contract.js';
import { MAX_LABEL_CODE_POINTS, sanitizeLabel } from '../shared/label.js';
import type { UnassignedProject } from './api.js';

/** Longest peer-supplied label, in code points (the server uses the same constant). */
export const MAX_GROUP_LABEL = MAX_LABEL_CODE_POINTS;
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

/** Peer text made safe to render: the same sanitizer the server uses (see `shared/label.ts`). */
export function cleanPeerText(value: string | null | undefined): string | null {
  return sanitizeLabel(value);
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

/** One foreign project as the collision pass sees it: a base label plus an optional disambiguating tag. */
interface Entry {
  id: string;
  label: string;
  tag: string | null;
}

/** Split the doc list into per-foreign-project buckets; docs without a usable id go to `other`. */
function bucketDocs(docs: DesignDocSummary[]): { byId: Map<string, DesignDocSummary[]>; other: DesignDocSummary[] } {
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
  return { byId, other };
}

/** A group per bucket, labelled from its project metadata when known, else from its first doc title. */
function buildDrafts(byId: Map<string, DesignDocSummary[]>, meta: Map<string, UnassignedProject>): Draft[] {
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
  return drafts;
}

/**
 * Final label for every foreign project whose base label equals a local Project name or another project's label.
 * Judged over the whole known universe (hidden and filtered-out projects included) and allocated in id order, so a
 * suffix does not change with the search text, a sync reorder or the doc window. A tag suffix is used when it is
 * unique; otherwise `#<n>`. Generated labels are reserved too, so they never collide with an existing label.
 */
function resolveCollisions(entries: Entry[], local: Set<string>): Map<string, string> {
  const sorted = [...entries].sort((a, b) => compare(a.id, b.id));
  const folds = new Map(sorted.map((entry) => [entry.id, foldLabel(entry.label)]));
  const members = new Map<string, string[]>();
  for (const entry of sorted) members.set(folds.get(entry.id)!, [...(members.get(folds.get(entry.id)!) ?? []), entry.id]);
  const colliding = sorted.filter((entry) => local.has(folds.get(entry.id)!) || members.get(folds.get(entry.id)!)!.length > 1);

  const reserved = new Set<string>([...local, ...folds.values()]);
  const tagged = new Map<string, number>();
  for (const entry of colliding) {
    if (entry.tag) {
      const key = foldLabel(`${entry.label} (${entry.tag})`);
      tagged.set(key, (tagged.get(key) ?? 0) + 1);
    }
  }

  const out = new Map<string, string>();
  for (const entry of colliding) {
    const withTag = entry.tag ? `${entry.label} (${entry.tag})` : null;
    if (withTag !== null && tagged.get(foldLabel(withTag)) === 1 && !reserved.has(foldLabel(withTag))) {
      out.set(entry.id, withTag);
      reserved.add(foldLabel(withTag));
      continue;
    }
    let n = members.get(folds.get(entry.id)!)!.indexOf(entry.id) + 1;
    while (reserved.has(foldLabel(`${entry.label} #${n}`))) n += 1;
    out.set(entry.id, `${entry.label} #${n}`);
    reserved.add(foldLabel(`${entry.label} #${n}`));
  }
  return out;
}

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

  const { byId, other } = bucketDocs(docs);
  const drafts = buildDrafts(byId, meta);

  if (labels === 'ready') {
    const universe = new Map<string, Entry>();
    const local = new Set(localProjectNames.map(foldLabel));
    for (const [id, project] of meta) {
      universe.set(id, { id, label: groupLabel(project).label, tag: cleanPeerText(project.senderTag) });
      const suggested = cleanPeerText(project.suggestion?.name);
      if (suggested) local.add(foldLabel(suggested));
    }
    for (const draft of drafts) universe.set(draft.id, { id: draft.id, label: draft.label, tag: draft.tag });
    const resolved = resolveCollisions([...universe.values()], local);
    for (const draft of drafts) draft.label = resolved.get(draft.id) ?? draft.label;
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
