import { isUnreadThread } from '../lib/unread-threads.js';
import type { FleetItem } from './fleet-item.js';

/**
 * Pure layout model for the Agents "List" view's left pane: the Unread filter,
 * the Project / Recent ordering, and the per-project sub-sections inside each
 * lane. Kept free of React so the grouping rules are unit-testable.
 */

export type MonitorListFilter = 'all' | 'unread';
export type MonitorListSort = 'project' | 'recent';

/** Projects with a single item in a lane fold into this bucket. */
export const OTHER_PROJECTS_KEY = 'other-projects';

export interface MonitorProjectSection {
  key: string;
  /** `null` for the folded "Other projects" bucket. */
  projectId: string | null;
  label: string;
  color?: string;
  items: FleetItem[];
}

/** Only threads track read state; CLI agents and schedules never count as unread. */
export function isUnreadFleetItem(item: FleetItem): boolean {
  return item.kind === 'thread' && isUnreadThread(item.thread);
}

/** Latest known activity for Recent ordering and the row's age column. */
export function fleetItemActivityAt(item: FleetItem): number | undefined {
  if (item.kind === 'thread') return item.thread.updatedAt ?? item.thread.createdAt;
  if (item.kind === 'agent') {
    const t = item.card.session;
    if (t.status === 'exited') return t.finishedAt ?? t.createdAt;
    return Math.max(t.lastInputAt ?? 0, t.createdAt);
  }
  return undefined;
}

/** Compact age: "now", "4m", "2h", "3d". */
export function formatAge(ms: number): string {
  const s = Math.floor(Math.max(0, ms) / 1000);
  if (s < 60) return 'now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export function applyMonitorFilter(items: readonly FleetItem[], filter: MonitorListFilter): FleetItem[] {
  return filter === 'unread' ? items.filter(isUnreadFleetItem) : [...items];
}

/** Newest activity first; items without a timestamp sink, original order breaks ties. */
export function sortByRecent(items: readonly FleetItem[]): FleetItem[] {
  return items
    .map((item, index) => ({ item, index, at: fleetItemActivityAt(item) ?? -Infinity }))
    .sort((a, b) => (b.at - a.at) || (a.index - b.index))
    .map(({ item }) => item);
}

/**
 * Split one lane into project sections, in first-seen order. Projects with a
 * single item fold into a trailing "Other projects" bucket when there are at
 * least two of them. Returns `null` (rows carry their own project name instead)
 * when the lane holds one project, or when no project has more than one item.
 */
export function sectionByProject(items: readonly FleetItem[]): MonitorProjectSection[] | null {
  const byProject = new Map<string, MonitorProjectSection>();
  for (const item of items) {
    let section = byProject.get(item.projectId);
    if (!section) {
      section = { key: item.projectId, projectId: item.projectId, label: item.projectName, color: item.projectColor, items: [] };
      byProject.set(item.projectId, section);
    }
    section.items.push(item);
  }
  if (byProject.size <= 1) return null;
  const sections = [...byProject.values()];
  const multi = sections.filter((s) => s.items.length > 1);
  const singles = sections.filter((s) => s.items.length === 1);
  if (multi.length === 0) return null;
  if (singles.length < 2) return sections;
  return [
    ...multi,
    { key: OTHER_PROJECTS_KEY, projectId: null, label: 'Other projects', items: singles.flatMap((s) => s.items) }
  ];
}
