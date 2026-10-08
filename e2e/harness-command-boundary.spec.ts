import { test, expect } from './fixtures/app.js';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

test('harness probes preserve large output and execute cmd shims at the Electron boundary', async ({ app }) => {
  const dir = join(app.home, 'cli probe with spaces');
  mkdirSync(dir);
  const script = join(dir, 'probe.cjs');
  const record = join(dir, 'invocation.json');
  writeFileSync(script, `require('node:fs').writeFileSync(${JSON.stringify(record)}, JSON.stringify({home:process.env.HOME,args:process.argv.slice(2)}));
process.stdout.write('x'.repeat(96000)+'\\n2026.09.02\\n');`);
  const binary = join(dir, process.platform === 'win32' ? 'codex.cmd' : 'codex');
  writeFileSync(binary, process.platform === 'win32'
    ? `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`
    : `#!/bin/sh\nexec '${process.execPath.replace(/'/g, "'\\''")}' '${script.replace(/'/g, "'\\''")}' "$@"\n`, { mode: 0o700 });
  await app.window.evaluate(async (binary) => { await window.cc.config.set({ codexBinary: binary }); }, binary);
  const result = await app.window.evaluate(async () => {
    const rows = await window.cc.harness.verify();
    return rows.find((row) => row.family === 'codex');
  });
  expect(result).toMatchObject({ installed: true, binary, normalizedVersion: '2026.09.02' });
  expect(JSON.parse(readFileSync(record, 'utf8'))).toMatchObject({ home: app.home, args: ['--version'] });
  await app.window.getByRole('link', { name: 'Settings', exact: true }).click();
  await app.window.getByTestId('settings-nav-harness').click();
  await expect(app.window.locator('#settings-anchor-harness-codex')).toContainText('2026.09.02', { timeout: 30_000 });

  // Failed version probes must be reflected in the IPC result, not as installed.
  writeFileSync(script, 'process.stderr.write("fixture failure");process.exit(7);');
  // The desktop IPC roster caches for 30 seconds. The host HTTP check is fresh.
  const failed = await app.window.evaluate(async () => {
    const response = await fetch('/api/v1/harness/verify');
    if (!response.ok) throw new Error(await response.text());
    const body = await response.json();
    return body.results.find((row: { family: string }) => row.family === 'codex');
  });
  expect(failed?.installed).toBe(false);

  writeFileSync(script, 'setInterval(() => {}, 1000);');
  const started = Date.now();
  const timedOut = await app.window.evaluate(async () => {
    const response = await fetch('/api/v1/harness/verify');
    if (!response.ok) throw new Error(await response.text());
    const body = await response.json();
    return body.results.find((row: { family: string }) => row.family === 'codex');
  });
  expect(timedOut?.installed).toBe(false);
  expect(Date.now() - started).toBeGreaterThanOrEqual(19_000);
  expect(Date.now() - started).toBeLessThan(30_000);
});
