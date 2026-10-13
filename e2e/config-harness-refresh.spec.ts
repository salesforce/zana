import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/app.js';

test.use({ launchEnv: { ZCC_FAKE_PROVIDER: '1' } });

test('canonical IPC and HTTP config writes refresh the background provider in the running app', async ({ app }) => {
  const binaries = ['first', 'second', 'third'].map(name => {
    const path = join(app.home, `background-${name}`);
    writeFileSync(path, `#!${process.execPath}\nprocess.stdout.write(${JSON.stringify(`Configured ${name} title`)});\n`, { mode: 0o700 });
    return path;
  });
  const infer = () => app.window.evaluate(() => window.cc.llmPrompts.test('builtin:tab-namer', { prompt: 'Name this config refresh check' }));
  await app.window.evaluate(binary => window.cc.config.set({ claudeBinary: binary }), binaries[0]);
  const first = await infer();
  expect(first.error).toBeUndefined();
  expect(first).toMatchObject({ ok: true, text: 'Configured first title' });

  await app.window.evaluate(binary => window.cc.config.set({ harnesses: { byId: { claude: { binary } } } }), binaries[1]);
  expect(await infer()).toMatchObject({ ok: true, text: 'Configured second title' });

  const saved = await app.window.evaluate(async binary => {
    const response = await fetch('/api/v1/config', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ harnesses: { byId: { claude: { binary } } } })
    });
    if (!response.ok) throw Error(await response.text());
    return (await response.json()).config;
  }, binaries[2]);
  expect(saved.claudeBinary).toBe(binaries[2]);
  const readBack = await app.window.evaluate(async () => (await (await fetch('/api/v1/config')).json()).config);
  expect(readBack.claudeBinary).toBe(binaries[2]);
  expect(await infer()).toMatchObject({ ok: true, text: 'Configured third title' });

  await app.window.evaluate(binary => window.cc.config.set({ claudeBinary: binary }), binaries[0]);
  expect(await infer()).toMatchObject({ ok: true, text: 'Configured first title' });
});
