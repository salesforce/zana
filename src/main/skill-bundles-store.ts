import { app } from 'electron';
import { EventEmitter } from 'node:events';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  watch,
  writeFileSync,
  type FSWatcher
} from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  SkillBundle,
  SkillBundleApplyMode,
  SkillBundleApplyResult,
  SkillBundleInput,
  SkillEntry
} from '../shared/types.js';
import { listSkills, setManyEnabled, type ListSkillsOptions } from './skills.js';

const bundlesDir = () => join(app.getPath('home'), '.zcc', 'skill-bundles');

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function writeJsonAtomic(file: string, value: unknown) {
  const payload = JSON.stringify(value, null, 2);
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, payload);
  renameSync(tmp, file);
}

function readBundleFile(path: string): SkillBundle | null {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<SkillBundle>;
    if (!raw || typeof raw !== 'object') return null;
    if (typeof raw.id !== 'string' || !raw.id.trim()) return null;
    if (typeof raw.name !== 'string' || !raw.name.trim()) return null;
    if (!Array.isArray(raw.skillIds)) return null;
    const skillIds = raw.skillIds.filter((s) => typeof s === 'string');
    return {
      id: raw.id,
      name: raw.name,
      description: typeof raw.description === 'string' ? raw.description : undefined,
      skillIds,
      createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString(),
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString()
    };
  } catch {
    return null;
  }
}

export class SkillBundlesStore extends EventEmitter {
  private watcher: FSWatcher | null = null;
  private debounce: NodeJS.Timeout | null = null;

  start() {
    ensureDir(bundlesDir());
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

  list(): SkillBundle[] {
    const dir = bundlesDir();
    if (!existsSync(dir)) return [];
    const out: SkillBundle[] = [];
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.json')) continue;
      const b = readBundleFile(join(dir, name));
      if (b) out.push(b);
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }

  create(input: SkillBundleInput): SkillBundle {
    const name = input.name?.trim();
    if (!name) throw new Error('name is required');
    ensureDir(bundlesDir());
    const now = new Date().toISOString();
    const bundle: SkillBundle = {
      id: randomUUID(),
      name,
      description: input.description?.trim() || undefined,
      skillIds: [...new Set(input.skillIds)],
      createdAt: now,
      updatedAt: now
    };
    writeJsonAtomic(join(bundlesDir(), `${bundle.id}.json`), bundle);
    this.scheduleEmit();
    return bundle;
  }

  update(id: string, patch: Partial<SkillBundleInput>): SkillBundle | null {
    const file = join(bundlesDir(), `${id}.json`);
    if (!existsSync(file)) return null;
    const existing = readBundleFile(file);
    if (!existing) return null;
    if (patch.name !== undefined && !patch.name.trim()) throw new Error('name is required');
    const next: SkillBundle = {
      ...existing,
      name: patch.name?.trim() ?? existing.name,
      description:
        patch.description !== undefined
          ? patch.description.trim() || undefined
          : existing.description,
      skillIds: patch.skillIds ? [...new Set(patch.skillIds)] : existing.skillIds,
      updatedAt: new Date().toISOString()
    };
    writeJsonAtomic(file, next);
    this.scheduleEmit();
    return next;
  }

  delete(id: string): boolean {
    const file = join(bundlesDir(), `${id}.json`);
    if (!existsSync(file)) return false;
    try {
      rmSync(file);
      this.scheduleEmit();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Apply a bundle:
   *  - additive: enable every user/project skill listed in the bundle; leave others alone.
   *  - exclusive: enable bundle's user/project skills, disable every other user/project skill.
   *
   * Plugin skills are filtered out — they're managed via Claude Code's
   * `/plugin` command and can't be toggled from settings.json. We keep their
   * ids in the bundle's skillIds (so re-applying after a plugin gets removed
   * doesn't lose intent) but they don't influence the write.
   *
   * skillOverrides is keyed by short skill name (per Claude Code docs); bundle
   * skillIds are qualified `${source}:${qualifiedName}` ids — we resolve via
   * `listSkills()` to bridge the two.
   */
  async apply(
    id: string,
    mode: SkillBundleApplyMode,
    options: ListSkillsOptions = {}
  ): Promise<SkillBundleApplyResult> {
    const bundle = readBundleFile(join(bundlesDir(), `${id}.json`));
    if (!bundle) {
      return { ok: false, applied: 0, skippedPlugin: 0, message: `Bundle not found: ${id}` };
    }
    const all = await listSkills(options);
    const byId = new Map<string, SkillEntry>(all.map((s) => [s.id, s]));
    const toEnableNames = new Set<string>();
    let skippedPlugin = 0;
    for (const sid of bundle.skillIds) {
      const skill = byId.get(sid);
      if (!skill) continue;
      // Read-only skills (Claude plugin skills, Cursor rules, …) can't be
      // toggled from settings.json — count them as skipped. `skippedPlugin`
      // keeps its historical name; it now means "skipped, not togglable".
      if (!skill.toggle.supported) {
        skippedPlugin += 1;
        continue;
      }
      toEnableNames.add(skill.name);
    }
    const updates: Array<{ name: string; enabled: boolean }> = [];
    if (mode === 'exclusive') {
      const seen = new Set<string>();
      for (const s of all) {
        if (!s.toggle.supported) continue;
        if (seen.has(s.name)) continue;
        seen.add(s.name);
        updates.push({ name: s.name, enabled: toEnableNames.has(s.name) });
      }
    } else {
      for (const name of toEnableNames) {
        updates.push({ name, enabled: true });
      }
    }
    await setManyEnabled(updates);
    return { ok: true, applied: updates.length, skippedPlugin };
  }

  /** Path of the bundles dir (for "Open in Finder"). */
  dir(): string {
    return bundlesDir();
  }

  private attachWatcher() {
    const dir = bundlesDir();
    try {
      this.watcher = watch(dir, { persistent: false }, () => this.scheduleEmit());
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
