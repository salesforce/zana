/**
 * Source-text guard: one `SplitThreadArea` per window.
 *
 * The split-layout store has a single active scope per window, and
 * `SplitThreadArea` activates its scope in a layout effect that re-runs when
 * the store's scope changes (#532). Two mounted instances with different scope
 * keys would keep re-activating each other's scope. Its only mount is
 * `SplitWorkspaceRoute`; a second mount needs the store to hold a scope per
 * instance first.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

const RENDERER_ROOT = fileURLToPath(new URL('..', import.meta.url));

function collectSources(dir: string): string[] {
  const out: string[] = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === '__tests__') continue;
    const full = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...collectSources(full));
    else if (/\.tsx?$/.test(ent.name) && !/\.test\.tsx?$/.test(ent.name)) out.push(full);
  }
  return out;
}

describe('SplitThreadArea mount sites', () => {
  it('is rendered from SplitWorkspaceRoute only', () => {
    const mounts = collectSources(RENDERER_ROOT)
      .filter((file) => /<SplitThreadArea\b/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(RENDERER_ROOT, file).split('\\').join('/'));
    expect(mounts).toEqual(['views/SplitWorkspaceRoute.tsx']);
  });
});
