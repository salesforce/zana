import { EventEmitter } from 'node:events';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  watch,
  writeFileSync,
  type FSWatcher
} from 'node:fs';
import { join } from 'node:path';
import type { ScheduleGroup, ScheduleGroupInput } from '@zana-ai/zcc-domain/product';

import { electronZccDataDir } from '../../electron-data-dir.js';

const centerDir = () => electronZccDataDir();
const groupsFile = () => join(centerDir(), 'groups.json');

/** Slug pattern shared with Project.tag — URL-safe, stable handle. */
const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,32}$/;

/**
 * Seeded on first run so the rail isn't empty. Users edit/extend these freely;
 * deleting them is fine (schedules referencing a missing group fall back to
 * Ungrouped). Re-seeding only happens when the file is absent, so a user who
 * deletes Personal/Work won't have them reappear.
 */
const SEED: ScheduleGroup[] = [
  { id: 'personal', name: 'Personal', color: '#8b5cf6', icon: 'User', sortIndex: 0 },
  { id: 'work', name: 'Work', color: '#3b82f6', icon: 'Briefcase', sortIndex: 1 }
];

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function writeJsonAtomic(file: string, value: unknown) {
  const payload = JSON.stringify(value, null, 2);
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, payload);
  renameSync(tmp, file);
}

function slugify(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 33);
  return SLUG_RE.test(base) ? base : `g-${Date.now().toString(36)}`;
}

function uniqueSlug(base: string, groups: ScheduleGroup[]): string {
  const ids = new Set(groups.map((group) => group.id));
  if (!ids.has(base)) return base;
  let suffix = 2;
  while (true) {
    const candidate = `${base.slice(0, 33 - (`-${suffix}`).length)}-${suffix}`;
    if (!ids.has(candidate)) return candidate;
    suffix += 1;
  }
}

function sanitizeGroup(raw: unknown): ScheduleGroup | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !SLUG_RE.test(r.id)) return null;
  if (typeof r.name !== 'string' || !r.name.trim()) return null;
  return {
    id: r.id,
    name: r.name.trim(),
    color: typeof r.color === 'string' ? r.color : undefined,
    icon: typeof r.icon === 'string' ? r.icon : undefined,
    sortIndex: typeof r.sortIndex === 'number' ? r.sortIndex : undefined
  };
}

/**
 * User-defined schedule groups (e.g. "Personal" / "Work"), persisted as a
 * single hand-editable file at `~/.zcc/groups.json`. The file is watched
 * so external edits go live without a restart (our own writes are debounced
 * through the same emit path, which is harmless — the list is idempotent).
 */
export class ScheduleGroupsStore extends EventEmitter {
  private watcher: FSWatcher | null = null;
  private debounce: NodeJS.Timeout | null = null;

  start() {
    ensureDir(centerDir());
    // Seed on first run only.
    if (!existsSync(groupsFile())) {
      writeJsonAtomic(groupsFile(), { version: 1, groups: SEED });
    }
    this.attachWatcher();
  }

  stop() {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    if (this.debounce) {
      clearTimeout(this.debounce);
      this.debounce = null;
    }
  }

  list(): ScheduleGroup[] {
    const file = groupsFile();
    if (!existsSync(file)) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      return [];
    }
    const arr = (parsed as { groups?: unknown })?.groups;
    if (!Array.isArray(arr)) return [];
    const out = arr
      .map(sanitizeGroup)
      .filter((g): g is ScheduleGroup => g !== null);
    out.sort((a, b) => (a.sortIndex ?? 0) - (b.sortIndex ?? 0) || a.name.localeCompare(b.name));
    return out;
  }

  create(input: ScheduleGroupInput): ScheduleGroup {
    if (!input.name?.trim()) throw new Error('name is required');
    const groups = this.list();
    // Derive a unique slug while preserving the loader's 33-character limit.
    const id = uniqueSlug(slugify(input.name), groups);
    const group: ScheduleGroup = {
      id,
      name: input.name.trim(),
      color: input.color,
      icon: input.icon,
      sortIndex: groups.length
    };
    this.persist([...groups, group]);
    return group;
  }

  update(id: string, patch: Partial<ScheduleGroupInput>): ScheduleGroup | null {
    const groups = this.list();
    const idx = groups.findIndex((g) => g.id === id);
    if (idx < 0) return null;
    const next: ScheduleGroup = {
      ...groups[idx],
      name: patch.name?.trim() || groups[idx].name,
      color: patch.color !== undefined ? patch.color || undefined : groups[idx].color,
      icon: patch.icon !== undefined ? patch.icon || undefined : groups[idx].icon
    };
    groups[idx] = next;
    this.persist(groups);
    return next;
  }

  /**
   * Remove a group. Schedules referencing it are NOT touched — an unresolvable
   * `group` id renders as Ungrouped, so deleting a group never loses schedules.
   */
  delete(id: string): boolean {
    const groups = this.list();
    const next = groups.filter((g) => g.id !== id);
    if (next.length === groups.length) return false;
    this.persist(next);
    return true;
  }

  reorder(orderedIds: string[]): ScheduleGroup[] {
    const groups = this.list();
    const byId = new Map(groups.map((g) => [g.id, g]));
    const reordered: ScheduleGroup[] = [];
    orderedIds.forEach((gid, i) => {
      const g = byId.get(gid);
      if (g) {
        reordered.push({ ...g, sortIndex: i });
        byId.delete(gid);
      }
    });
    // Any ids not named in `orderedIds` keep their relative order at the end.
    let tail = reordered.length;
    for (const g of byId.values()) reordered.push({ ...g, sortIndex: tail++ });
    this.persist(reordered);
    return reordered;
  }

  /** Path of the groups file (for "Open in Finder"). */
  file(): string {
    return groupsFile();
  }

  private persist(groups: ScheduleGroup[]) {
    ensureDir(centerDir());
    writeJsonAtomic(groupsFile(), { version: 1, groups });
    this.scheduleEmit();
  }

  private attachWatcher() {
    try {
      // Watch the dir (not the file) so an atomic rename-into-place is caught.
      this.watcher = watch(centerDir(), { persistent: false }, (_e, name) => {
        if (!name || name === 'groups.json') this.scheduleEmit();
      });
    } catch {
      // ignore — fall back to refresh-on-demand on fs without watch support.
    }
  }

  private scheduleEmit() {
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => {
      this.debounce = null;
      this.emit('changed', this.list());
    }, 150);
  }
}
