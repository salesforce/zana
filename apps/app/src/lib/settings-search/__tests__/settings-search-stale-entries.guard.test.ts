import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ALLOWED_STALE_IDS } from '../completeness-allowlist';
import { SETTINGS_SOURCE_DIRS } from '../guard-config';
import type { SettingsSearchEntry } from '../types';

// Stale-entry guard (design §3.5): every page-entry id must be a `searchId` in
// source and every anchor an `anchorId`, so a renamed/removed row can't leave a
// search result that jumps nowhere.

const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const ATTR = (name: string) =>
  new RegExp(`\\b${name}\\s*[=:]\\s*(?:"([^"]+)"|'([^']+)'|\\{\\s*(?:'([^']+)'|"([^"]+)"|\`([^\`$]+)\`)\\s*\\})`, 'g');

/**
 * Static `searchId` / `anchorId` literals declared in one source text. A literal
 * `data-settings-target` counts as a searchId too, so raw markup can carry the
 * target attribute directly instead of being wrapped just to satisfy this guard.
 */
export function collectSourceIds(source: string): { searchIds: Set<string>; anchorIds: Set<string> } {
  const grab = (name: string) => {
    const out = new Set<string>();
    for (const m of source.matchAll(ATTR(name))) out.add(m.slice(1).find(Boolean) as string);
    return out;
  };
  return {
    searchIds: new Set([...grab('searchId'), ...grab('data-settings-target')]),
    anchorIds: grab('anchorId')
  };
}

/** Entries whose id / anchor is missing from the given source ids. */
export function findStaleEntries(
  entries: readonly SettingsSearchEntry[],
  ids: { searchIds: ReadonlySet<string>; anchorIds: ReadonlySet<string> },
  allowed: ReadonlySet<string> = new Set()
): string[] {
  const stale: string[] = [];
  for (const e of entries) {
    if (!ids.searchIds.has(e.id) && !allowed.has(e.id)) stale.push(`${e.id}: no searchId in source`);
    if (e.anchor && !ids.anchorIds.has(e.anchor) && !allowed.has(e.anchor)) stale.push(`${e.id}: anchor "${e.anchor}" has no anchorId in source`);
  }
  return stale;
}

function sourceIds() {
  const searchIds = new Set<string>();
  const anchorIds = new Set<string>();
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        if (name !== '__tests__') walk(full);
      } else if (/\.tsx?$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)) {
        const ids = collectSourceIds(readFileSync(full, 'utf8'));
        ids.searchIds.forEach((i) => searchIds.add(i));
        ids.anchorIds.forEach((i) => anchorIds.add(i));
      }
    }
  };
  for (const d of SETTINGS_SOURCE_DIRS) walk(join(SRC_ROOT, d));
  return { searchIds, anchorIds };
}

const entryModules = import.meta.glob<{ default?: readonly SettingsSearchEntry[]; entries?: readonly SettingsSearchEntry[] }>(
  '../entries/*.ts',
  { eager: true }
);

describe('settings-search stale-entry guard', () => {
  it('every page entry id / anchor exists in source', () => {
    const entries = Object.values(entryModules).flatMap((m) => [...(m.entries ?? m.default ?? [])]);
    const allowed = new Set(ALLOWED_STALE_IDS.map((a) => a.id));
    expect(findStaleEntries(entries, sourceIds(), allowed)).toEqual([]);
  });

  it('keeps stale-id allowlist entries justified', () => {
    for (const a of ALLOWED_STALE_IDS) expect(a.reason.trim().length).toBeGreaterThan(10);
  });

  describe('fixtures', () => {
    const entry = (over: Partial<SettingsSearchEntry>): SettingsSearchEntry => ({
      id: 'agents.auto-close', section: 'agents', label: 'Auto close', kind: 'setting', ...over
    });
    const ids = collectSourceIds(`
      <ToggleSwitch searchId="agents.auto-close" />
      <Section anchorId={'auto-close-idle'} />
      <Field searchId={\`agents.tpl\`} />
    `);

    it('accepts a literal data-settings-target on raw markup as a searchId', () => {
      const raw = collectSourceIds('<button className="settings-btn" data-settings-target="machines.add-machine">Add</button>');
      expect([...raw.searchIds]).toEqual(['machines.add-machine']);
      // Dynamic targets (runtime provider rows) are not static ids.
      expect([...collectSourceIds('<li data-settings-target={personaSearchId(p.id)} />').searchIds]).toEqual([]);
    });

    it('collects static ids in every literal form', () => {
      expect([...ids.searchIds].sort()).toEqual(['agents.auto-close', 'agents.tpl']);
      expect([...ids.anchorIds]).toEqual(['auto-close-idle']);
    });

    it('passes for a live id and anchor', () => {
      expect(findStaleEntries([entry({ anchor: 'auto-close-idle' })], ids)).toEqual([]);
    });

    it('FAILS for an id missing from source', () => {
      expect(findStaleEntries([entry({ id: 'agents.gone' })], ids)).toEqual(['agents.gone: no searchId in source']);
    });

    it('FAILS for an anchor missing from source', () => {
      expect(findStaleEntries([entry({ anchor: 'nope' })], ids)).toEqual(['agents.auto-close: anchor "nope" has no anchorId in source']);
    });

    it('honours the allowlist for dynamic ids', () => {
      expect(findStaleEntries([entry({ id: 'agents.dyn' })], ids, new Set(['agents.dyn']))).toEqual([]);
    });
  });
});
