import { chmodSync, existsSync, rmSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, launchApp, closeApp } from './fixtures/app.js';

/**
 * Regression: an enabled server plugin whose activation failed for good (missing
 * dependency) and never declared a tool policy must not make the native tool-policy
 * gate deny every tool. It used to answer "plugin tool policy not ready: <id>" for
 * Write/Edit forever, which broke Squad orchestrators writing their plan file.
 */
const stub = String.raw`
const {spawnSync} = require('node:child_process');
const {writeFileSync} = require('node:fs');
const {createInterface} = require('node:readline');
if (process.argv.includes('--version')) { console.log('2.1.296'); process.exit(0); }
const settingsIndex = process.argv.indexOf('--settings');
const commands = JSON.parse(process.argv[settingsIndex + 1]).hooks.PreToolUse.flatMap(h => h.hooks.map(h => h.command)).filter(c => c.includes('ZCC_NATIVETOOL_URL'));
if (!commands.length) throw new Error('Missing native policy hook');
console.log('POLICY_READY');
let n = 0;
createInterface({input:process.stdin}).on('line', () => {
  n += 1;
  const input = {hook_event_name:'PreToolUse', prompt_id:'prompt-probe', tool_use_id:'call-' + n, tool_name:'Write', tool_input:{path:'marker.txt'}};
  const result = spawnSync('/bin/sh', ['-c', commands[0]], { input:JSON.stringify(input), timeout:6000, stdio:['pipe','pipe','pipe'] });
  if (result.error || result.signal || result.status !== 0) {
    writeFileSync('write-result.json', JSON.stringify({decision: 'hook-failed', reason: String(result.error || result.signal || ('exit ' + result.status)) + ' ' + result.stderr.toString().slice(0, 500)}));
    console.log('POLICY_RESULT');
    return;
  }
  const output = result.stdout.toString().trim();
  const parsed = output ? JSON.parse(output).hookSpecificOutput : {};
  writeFileSync('write-result.json', JSON.stringify({decision: parsed.permissionDecision ?? 'no-decision', reason: parsed.permissionDecisionReason ?? ''}));
  console.log('POLICY_RESULT');
});
`;

test('a plugin that failed activation without declaring a tool policy does not block native tools', async ({ home }) => {
  test.setTimeout(150_000);
  const pluginDir = join(home, 'broken-plugin');
  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(join(pluginDir, 'package.json'), JSON.stringify({
    name: 'zcc-plugin-broken-dep', version: '0.1.0', type: 'module',
    engines: { zcc: '>=1.0.0', zccPluginSdk: '>=0.1.0' },
    zcc: { name: 'Broken Dep', description: 'Fixture: server imports a missing module.', branding: { icon: 'Puzzle' }, server: './server.mjs' }
  }));
  writeFileSync(join(pluginDir, 'server.mjs'), "import 'zz-module-that-does-not-exist-e2e';\nexport default () => {};\n");
  const store = join(home, '.zcc/plugins');
  mkdirSync(store, { recursive: true });
  writeFileSync(join(store, 'installed.json'), JSON.stringify({
    version: 1,
    plugins: [{
      id: 'broken-dep', version: '0.1.0', name: 'Broken Dep', enabled: true, status: 'running', provenance: 'direct',
      sourceKind: 'path', source: `path:${pluginDir}`, rootDir: pluginDir, serverEntry: './server.mjs', appEntry: null, statusDetail: null, description: 'Fixture', icon: 'Puzzle',
      npmResolvedVersion: null, npmIntegrity: null, gitResolvedCommit: null, catalogMarketplace: null, catalogEntryId: null,
      toolPolicy: 'unknown', installedAt: Date.now(), updatedAt: Date.now()
    }]
  }));

  const app = await launchApp(home, { e2e: true, env: { ZCC_FAKE_PROVIDER: '1' }, initialConfig: { sponsorPromptDismissed: true } });
  const { window } = app;
  const dir = join(home, 'degraded-policy-project');
  mkdirSync(dir);
  const binary = join(dir, 'claude-stub.cjs');
  writeFileSync(binary, `#!${process.execPath}\n${stub}`);
  chmodSync(binary, 0o755);
  let sessionId: string | undefined;
  try {
    let lastRow: unknown;
    await expect.poll(
      async () => {
        lastRow = await window.evaluate(async () => (await window.cc.pluginApps.list()).find((p) => p.id === 'broken-dep'));
        return (lastRow as { status?: string } | undefined)?.status;
      },
      { timeout: 60_000, message: () => `last row: ${JSON.stringify(lastRow)}` }
    ).toBe('degraded');

    const projectId = await window.evaluate(async (path) => {
      const result = await window.cc.projects.add(path);
      if (!result.ok) throw new Error(result.message);
      return result.value.id;
    }, dir);
    await window.evaluate((bin) => window.cc.config.set({ claudeBinary: bin }), binary);
    sessionId = await window.evaluate(async (projectId) => {
      const result = await window.cc.terminals.create({ projectId, profile: 'claude', cols: 100, rows: 32 });
      if (!result.ok) throw new Error(result.message);
      return result.value.id;
    }, projectId);

    // Retry/watchdog recovery may keep the plugin "starting" for a while (still fail-closed);
    // the gate must open once the failure is final.
    const decision = async () => {
      rmSync(join(dir, 'write-result.json'), { force: true });
      await window.evaluate((id) => window.cc.terminals.write(id, 'write\r'), sessionId!);
      await expect.poll(() => existsSync(join(dir, 'write-result.json')), { timeout: 15_000 }).toBe(true);
      return JSON.parse(readFileSync(join(dir, 'write-result.json'), 'utf8')) as { decision: string; reason: string };
    };
    await expect.poll(async () => (await decision()).decision, { timeout: 90_000, intervals: [2_000] }).toBe('no-decision');
    expect((await decision()).reason).not.toContain('not ready');
  } finally {
    if (sessionId) await window.evaluate((id) => window.cc.terminals.close(id), sessionId).catch(() => undefined);
    await closeApp(app.electron).catch(() => undefined);
  }
});
