import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { slackDiagramBrowserEnv } from '../e2e/fixtures/slack-diagram-browser';

const homes: string[] = [];
function temporaryHome() {
  const home = mkdtempSync(join(tmpdir(), 'slack-browser-'));
  homes.push(home);
  return home;
}
afterEach(() => { for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }); });

it.each(['darwin', 'win32'] as const)('preserves browser discovery on %s', platform => {
  const home = temporaryHome();
  expect(slackDiagramBrowserEnv(home, '/unused/chromium', platform)).toEqual({});
  expect(readdirSync(home)).toEqual([]);
});

it.skipIf(process.platform === 'win32')('runs the supplied Linux browser and preserves literal paths and arguments', () => {
  const home = temporaryHome();
  const browser = join(home, "browser with 'quotes' and $variables");
  writeFileSync(browser, '#!/bin/sh\nprintf "%s\\n" "$@"\n', { mode: 0o700 });
  const env = slackDiagramBrowserEnv(home, browser, 'linux');
  const launcher = env.PUPPETEER_EXECUTABLE_PATH;
  expect(statSync(launcher).mode & 0o777).toBe(0o700);
  expect(execFileSync(launcher, ['--headless', 'a b', '$literal'], { encoding: 'utf8' }))
    .toBe('--no-sandbox\n--headless\na b\n$literal\n');
});
