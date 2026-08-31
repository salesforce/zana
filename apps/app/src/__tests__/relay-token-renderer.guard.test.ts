/**
 * The pairing relay token is main/server-only (electron-vite `main` define).
 * Renderer code must never name the bake identifier or the env key.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

const RENDERER_ROOT = fileURLToPath(new URL('..', import.meta.url));
const FORBIDDEN = /ZCC_RELAY_TOKEN|__ZCC_BUNDLED_RELAY_TOKEN__/;

function collectSources(dir: string): string[] {
  const out: string[] = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === '__tests__') continue;
    const full = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...collectSources(full));
    else if (/\.tsx?$/.test(ent.name)) out.push(full);
  }
  return out;
}

describe('pairing relay token stays out of the renderer', () => {
  it('does not mention ZCC_RELAY_TOKEN or the bake identifier in apps/app/src', () => {
    const offenders: string[] = [];
    for (const file of collectSources(RENDERER_ROOT)) {
      const rel = relative(RENDERER_ROOT, file);
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        if (FORBIDDEN.test(line)) offenders.push(`${rel}:${i + 1}`);
      });
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });
});
