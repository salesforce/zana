// DEBUG driver: launch the built app, fire a REAL autonomous run with a goal
// that forces the agents to actually work (so they hit whatever still prompts),
// let it run ~90s, then report: spawned agent flags, any blocked notify events,
// and the captured raw terminal output (so we can read the literal prompt).
import { _electron as electron } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const APP_DIR = path.resolve(import.meta.dirname, '..');
const ELECTRON_BIN = path.join(
  APP_DIR,
  'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
);
const CAPTURE_DIR = '/tmp/zcc-yolo-capture';

const PROJECT_ID = '299a1323-9587-41e2-b964-82c2d6f566c9'; // zana-command-center
const TEAM_ID = 'builtin:review-squad';
// A goal that makes them actually DO things (read files, decide, message peers)
// — the kind of run where a stray AskUserQuestion / permission surfaces.
const GOAL =
  'Investigate the repo and propose 3 concrete improvements to the README. ' +
  'Coordinate as a team, make your own decisions without asking the user, and ' +
  'when done call complete_autonomous_run with the proposals.';

const log = (m) => console.log(m);

function claudePids() {
  let out = '';
  try {
    out = execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' });
  } catch {
    return [];
  }
  return out
    .split('\n')
    .filter((l) => l.includes('--session-id') && !l.includes('@zana-ai/mcp'))
    .map((l) => parseInt(l.trim().split(/\s+/)[0], 10))
    .filter((n) => Number.isFinite(n));
}
const argvFor = (pid) => {
  try {
    return execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
};

try {
  fs.rmSync(CAPTURE_DIR, { recursive: true, force: true });
} catch {
  /* ignore */
}

const app = await electron.launch({
  executablePath: ELECTRON_BIN,
  args: [APP_DIR],
  timeout: 60_000,
  env: { ...process.env, ZCC_DEBUG_YOLO_CAPTURE: CAPTURE_DIR }
});

let runId = null;
try {
  await new Promise((r) => setTimeout(r, 9_000));
  const page =
    app.windows().find((w) => !w.url().startsWith('devtools://')) ?? (await app.firstWindow());
  await page.waitForFunction(() => !!window.cc?.teams?.launchAutonomous, { timeout: 20_000 });

  const before = new Set(claudePids());
  const res = await page.evaluate(
    async ({ teamId, projectId, goal }) =>
      window.cc.teams.launchAutonomous(teamId, projectId, goal),
    { teamId: TEAM_ID, projectId: PROJECT_ID, goal: GOAL }
  );
  log('launchAutonomous: ' + JSON.stringify(res));
  if (res?.ok) runId = res.value.runId;

  await new Promise((r) => setTimeout(r, 4_000));
  const newPids = claudePids().filter((p) => !before.has(p));
  for (const pid of newPids) {
    const a = argvFor(pid);
    log(
      `  pid ${pid}: yolo=${a.includes('--dangerously-skip-permissions')} ` +
        `send=${/--allowedTools\s+\S*agent_send/.test(a)} ` +
        `noAsk=${/--disallowedTools\s+\S*AskUserQuestion/.test(a)}`
    );
  }

  // Let the team actually WORK for 80s — this is where a real prompt surfaces.
  log('letting the team run for 80s to surface any live prompt…');
  await new Promise((r) => setTimeout(r, 80_000));
} catch (e) {
  log('driver error: ' + String(e));
} finally {
  try {
    if (runId) {
      const page =
        app.windows().find((w) => !w.url().startsWith('devtools://')) ??
        (await app.firstWindow());
      await page.evaluate((id) => window.cc.teams.stopAutonomous(id), runId).catch(() => {});
    }
  } catch {
    /* ignore */
  }
  await app.close().catch(() => {});
  log('app closed. capture dir: ' + CAPTURE_DIR);
}
