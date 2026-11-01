import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/app.js';

test('Inbox summary memo reuses identical provider input and invalidates after provider config changes', async ({ app }) => {
  test.setTimeout(120_000);
  const { window: page, home } = app;
  const makeProvider = (name: string) => {
    const counter = join(home, `${name}-calls.txt`);
    const args = join(home, `${name}-args.jsonl`);
    const binary = join(home, `${name}-claude.cjs`);
    writeFileSync(binary, `#!${process.execPath}\nconst fs = require('node:fs');\nconst counter = ${JSON.stringify(counter)};\nconst args = ${JSON.stringify(args)};\nconst calls = fs.existsSync(counter) ? Number(fs.readFileSync(counter, 'utf8')) : 0;\nfs.writeFileSync(counter, String(calls + 1));\nfs.appendFileSync(args, JSON.stringify(process.argv.slice(2)) + '\\n');\nprocess.stdout.write(${JSON.stringify('{"headline":"Memo summary","done":[],"attention":[]}')});\n`, { mode: 0o700 });
    return { binary, counter, args };
  };
  const first = makeProvider('first');
  const second = makeProvider('second');

  mkdirSync(join(home, '.zcc', 'inbox'), { recursive: true });
  writeFileSync(join(home, '.zcc', 'inbox', 'entries.jsonl'), `${JSON.stringify({
    id: 'memo-summary', projectId: 'memo-project', ts: Date.now() + 60_000, subject: 'Memo summary source', comments: 'Stable source text'
  })}\n`);
  await page.reload();
  await page.evaluate(binary => window.cc.config.set({ claudeBinary: binary }), first.binary);

  const printCalls = (args: string) => args.split('\n').filter(line => line.includes('"--print"')).length;
  const summarize = () => page.evaluate(() => window.cc.inbox.summarize(null));
  expect(await summarize()).toMatchObject({ ok: true });
  expect(await summarize()).toMatchObject({ ok: true });
  expect(printCalls(readFileSync(first.args, 'utf8'))).toBe(1);

  await page.evaluate(binary => window.cc.config.set({ claudeBinary: binary }), second.binary);
  expect(await summarize()).toMatchObject({ ok: true });
  expect(printCalls(readFileSync(second.args, 'utf8'))).toBe(1);
});
