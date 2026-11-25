/**
 * Source-text guard: a Squad's effective transport comes from the resolver (squad-transport-pin.ts), pinned
 * once per launch. Only the launch path, which receives the already-pinned team, may read `team.transport`
 * directly in the desktop main process. Any other file must call `resolveTeamTransport` or read the
 * execution record's `resolvedTransport`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..');
const ALLOWED = new Set(['host.ts', 'team-launch-support.ts', 'on-demand-seat.ts', 'squad-transport-pin.ts', 'squad-proposals/service.ts']);

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' || name === 'node_modules' ? [] : sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('team.transport reads', () => {
  it('stay inside the pinned launch path', () => {
    const offenders = sources(root)
      .filter((file) => !ALLOWED.has(relative(root, file)))
      .filter((file) => /\b(?:team|squad)\??\.transport\s*[!=]==?\s*'(?:MODERN|CLI)'/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(root, file));
    expect(offenders).toEqual([]);
  });
});
