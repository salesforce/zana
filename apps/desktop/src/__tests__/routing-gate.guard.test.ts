import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = (file: string) => readFileSync(join(__dirname, '..', file), 'utf8');

describe('shared routing enforcement gate', () => {
  it('host.ts derives enforcement only through resolveRoutingEnforcement', () => {
    const host = src('host.ts');
    // The old inline duplicates of the enforcement test must not come back.
    expect(host).not.toMatch(/team\?\.routingEnforced\s*\?\?/);
    expect(host).not.toMatch(/\.routingEnforced\s*\?\?/);
    expect(host).not.toContain('decideTeamRoutingEnforcement');
    expect(host).not.toMatch(/workerRoutes\.every\(\(slot\) => !!slot\.level\)/);
    expect(host.match(/resolveRoutingEnforcement\(/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it('the Team override is read in exactly one place', () => {
    expect(src('team-routing-enforcement.ts').match(/\.routingEnforced\s*\?\?/g)).toHaveLength(1);
  });
});
