import type { DesignDocSummary } from '../shared/contract.js';

export type SectionKind = 'pinned' | 'needs-me' | 'project' | 'recent';

/** A doc in the list with the alternatives that nest under it. */
export interface ListEntry {
  doc: DesignDocSummary;
  alternatives: DesignDocSummary[];
}

export interface ListSection {
  /** Stable across reloads; remembers whether the section is collapsed. */
  key: string;
  kind: SectionKind;
  label: string;
  entries: ListEntry[];
  /** Docs in the section, alternatives included. */
  count: number;
  /** Project sections: the project they hold, null for global docs. */
  projectId?: string | null;
  /** The project the user is working in; listed first. */
  current?: boolean;
}

export interface SectionOptions {
  /** Group the remaining docs by project; otherwise one "Recent" timeline. */
  byProject: boolean;
  projectName(projectId: string): string;
  /** Listed first among the projects, whatever its recency. */
  currentProjectId?: string | null;
}

/**
 * Lay the (newest-first) doc list out in sections: Pinned, then Needs me
 * (open comments), then the rest by project or as one timeline. Each doc
 * appears once; an alternative follows the doc it is an alternative to, and
 * stands alone when that doc is not in the list.
 */
export function buildSections(docs: DesignDocSummary[], options: SectionOptions): ListSection[] {
  const listed = new Set(docs.map((doc) => doc.id));
  const alternatives = new Map<string, DesignDocSummary[]>();
  const tops: DesignDocSummary[] = [];
  for (const doc of docs) {
    if (doc.alternativeTo && doc.alternativeTo !== doc.id && listed.has(doc.alternativeTo)) {
      const siblings = alternatives.get(doc.alternativeTo) ?? [];
      siblings.push(doc);
      alternatives.set(doc.alternativeTo, siblings);
    } else {
      tops.push(doc);
    }
  }
  const entry = (doc: DesignDocSummary): ListEntry => ({ doc, alternatives: alternatives.get(doc.id) ?? [] });

  const sections: ListSection[] = [];
  const add = (key: string, kind: SectionKind, label: string, members: DesignDocSummary[], extra: Partial<ListSection> = {}) => {
    if (!members.length) return;
    const entries = members.map(entry);
    sections.push({ key, kind, label, entries, count: entries.reduce((sum, item) => sum + 1 + item.alternatives.length, 0), ...extra });
  };

  const pinned = tops.filter((doc) => doc.pinnedAt !== null);
  const needsMe = tops.filter((doc) => doc.pinnedAt === null && doc.openComments > 0);
  const rest = tops.filter((doc) => doc.pinnedAt === null && doc.openComments === 0);
  add('pinned', 'pinned', 'Pinned', pinned);
  add('needs-me', 'needs-me', 'Needs me', needsMe);

  if (!options.byProject) {
    add('recent', 'recent', 'Recent', rest);
    return sections;
  }
  // Newest-first input, so first appearance orders projects by latest activity.
  const groups = new Map<string, { projectId: string | null; docs: DesignDocSummary[] }>();
  const current = options.currentProjectId ?? null;
  if (current) groups.set(`project:${current}`, { projectId: current, docs: [] });
  for (const doc of rest) {
    const key = doc.projectId ? `project:${doc.projectId}` : 'project:';
    const group = groups.get(key) ?? { projectId: doc.projectId, docs: [] };
    group.docs.push(doc);
    groups.set(key, group);
  }
  for (const [key, group] of groups) {
    add(key, 'project', group.projectId ? options.projectName(group.projectId) : 'Global', group.docs, {
      projectId: group.projectId,
      current: !!current && group.projectId === current
    });
  }
  return sections;
}

/** Parse the remembered set of collapsed section keys. */
export function parseCollapsed(raw: string): Set<string> {
  try {
    const value = JSON.parse(raw) as unknown;
    return new Set(Array.isArray(value) ? value.filter((key): key is string => typeof key === 'string') : []);
  } catch {
    return new Set();
  }
}

export function toggleCollapsed(raw: string, key: string): string {
  const keys = parseCollapsed(raw);
  if (keys.has(key)) keys.delete(key);
  else keys.add(key);
  return JSON.stringify([...keys]);
}

const SWATCH_HUES = [217, 262, 173, 24, 330, 142, 45, 195];

/** A stable color for a project, so its docs read as one group across sections. */
export function projectSwatch(projectId: string | null): string {
  if (!projectId) return 'var(--text-dim)';
  let hash = 0;
  for (let index = 0; index < projectId.length; index += 1) hash = (hash * 31 + projectId.charCodeAt(index)) | 0;
  return `hsl(${SWATCH_HUES[Math.abs(hash) % SWATCH_HUES.length]} 62% 52%)`;
}
