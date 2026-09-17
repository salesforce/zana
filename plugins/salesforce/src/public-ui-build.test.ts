import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { buildPluginApp } from '../../../packages/plugin-build/src/build-plugin.js';

it('bundles a separate plugin using the public UI and native-panel package exports', async () => {
  const root = mkdtempSync(join(tmpdir(), 'salesforce-ui-consumer-'));
  try {
    mkdirSync(join(root, 'node_modules/@zcc-ext'), { recursive: true });
    symlinkSync(fileURLToPath(new URL('..', import.meta.url)), join(root, 'node_modules/@zcc-ext/salesforce'));
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: '@zcc-ext/salesforce-ui-consumer', version: '1.0.0', type: 'module', zcc: { name: 'Consumer', app: './app.js' } }));
    writeFileSync(join(root, 'app.tsx'), `
      import { definePluginApp } from '@zana-ai/zcc-plugin-sdk/app';
      import { SalesforcePanelFrame, OrgBadge } from '@zcc-ext/salesforce/ui';
      import { registerSalesforcePanels } from '@zcc-ext/salesforce/panels';
      export default definePluginApp(app => {
        registerSalesforcePanels(app, { panels: ['soql', 'record', 'operations'] });
        app.slots.navPanel({ id:'context', title:'Consumer', component:() => <SalesforcePanelFrame title="Consumer"><OrgBadge org={null} /></SalesforcePanelFrame> });
      });
    `);
    await buildPluginApp(root, '2.1.2');
    const artifact = readFileSync(join(root, 'app.js'), 'utf8');
    expect(artifact).toContain('sf-inspect-query');
    expect(artifact).not.toMatch(/node:fs|node:child_process|node:async_hooks|FAKE_PRIVATE_TOKEN/);
    expect(JSON.parse(readFileSync(join(root, 'app.meta.json'), 'utf8')).pluginId).toBe('salesforce-ui-consumer');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
