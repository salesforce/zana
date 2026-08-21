import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(join(process.cwd(), 'apps/desktop/src/host.ts'), 'utf8');

describe('startup migration bootstrap integration', () => {
  it('routes app readiness through migration before normal bootstrap', () => {
    expect(source).not.toMatch(/app\.whenReady\(\)\.then\(bootstrapNormal\)/);
    expect(source.match(/app\.whenReady\(\)\.then\(bootstrap\)/g)).toHaveLength(2);
    expect(source).toMatch(/async function bootstrap\(\) \{[\s\S]*registerStartupStateIpc\(\);[\s\S]*await runStartupMigration\(\);[\s\S]*\}/);
    expect(source).toMatch(/runStartupGate\(\{[\s\S]*migrate: \(\) => runHarnessRoutingMigration\(migrationDataDir\(\)\),[\s\S]*launchNormal: bootstrapNormal/);
  });

  it('keeps owning config/provider reads inside normal bootstrap', () => {
    const gate = source.indexOf('async function runStartupMigration()');
    const normal = source.indexOf('function bootstrapNormal()');
    const providerRead = source.indexOf('rebuildProviders(store.getConfig());');
    expect(gate).toBeGreaterThan(-1);
    expect(normal).toBeGreaterThan(gate);
    expect(providerRead).toBeGreaterThan(normal);
  });
});
