// One-shot verification: launch the built Electron app, trigger a REAL
// autonomous-team launch through the exact path the UI button uses
// (window.cc.teams.launchAutonomous → IPC → launchTeam → supervisor → pty),
// then inspect the spawned agent OS processes to PROVE no approval gate remains:
//   - every agent has --dangerously-skip-permissions
//   - every agent has agent_send pre-approved in --allowedTools
// Then stop the run and quit. Trivial goal + instant stop so the yolo agents
// never do real work in the repo.
import { _electron as electron } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import * as path from 'node:path';

const APP_DIR = path.resolve(import.meta.dirname, '..');
const ELECTRON_BIN = path.join(
  APP_DIR,
  'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
);

const PROJECT_ID = '299a1323-9587-41e2-b964-82c2d6f566c9'; // zana-command-center
const TEAM_ID = 'builtin:review-squad';
const GOAL = 'Reply with the single word ACK and nothing else.';

const log = (m) => console.log(m);

// All claude agent pids right now (those launched with a --session-id), via
// execFileSync (no shell → no injection surface).
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

function argvFor(pid) {
  try {
    return execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

const app = await electron.launch({
  executablePath: ELECTRON_BIN,
  args: [APP_DIR],
  timeout: 60_000,
  env: { ...process.env }
});

let runId = null;
try {
  log('launched; waiting for renderer + IPC to be ready…');
  await new Promise((r) => setTimeout(r, 9_000));

  const page =
    app.windows().find((w) => !w.url().startsWith('devtools://')) ?? (await app.firstWindow());

  await page.waitForFunction(() => !!window.cc?.teams?.launchAutonomous, { timeout: 20_000 });

  const before = new Set(claudePids());
  log(`claude agents before launch: ${before.size}`);

  // THE REAL CALL — identical to what the "Launch autonomous team" button fires.
  const res = await page.evaluate(
    async ({ teamId, projectId, goal }) =>
      window.cc.teams.launchAutonomous(teamId, projectId, goal),
    { teamId: TEAM_ID, projectId: PROJECT_ID, goal: GOAL }
  );
  log('launchAutonomous result: ' + JSON.stringify(res));

  if (!res?.ok) {
    log('VERIFY_RESULT: FAIL — launchAutonomous returned an error');
  } else {
    runId = res.value.runId;
    await new Promise((r) => setTimeout(r, 4_000)); // let ptys spawn

    const after = claudePids();
    const newPids = after.filter((p) => !before.has(p));
    log(`new agent pids: ${JSON.stringify(newPids)}`);

    let allYolo = newPids.length > 0;
    let allAgentSend = newPids.length > 0;
    let allNoAsk = newPids.length > 0;
    for (const pid of newPids) {
      const argv = argvFor(pid);
      const yolo = argv.includes('--dangerously-skip-permissions');
      const sendAllowed = /--allowedTools\s+\S*mcp__zcc-inbox__agent_send/.test(argv);
      const askDenied = /--disallowedTools\s+\S*AskUserQuestion/.test(argv);
      log(`  pid ${pid}: yolo=${yolo} agent_send_allowed=${sendAllowed} AskUserQuestion_denied=${askDenied}`);
      if (!yolo) allYolo = false;
      if (!sendAllowed) allAgentSend = false;
      if (!askDenied) allNoAsk = false;
    }

    if (newPids.length === 0) {
      log('VERIFY_RESULT: FAIL — no agent processes were spawned');
    } else if (allYolo && allAgentSend && allNoAsk) {
      log(
        `VERIFY_RESULT: PASS — ${newPids.length} agents: all yolo + agent_send pre-approved + AskUserQuestion disallowed (no approval/question gate)`
      );
    } else {
      log(
        `VERIFY_RESULT: FAIL — allYolo=${allYolo} allAgentSend=${allAgentSend} allNoAsk=${allNoAsk}`
      );
    }
  }
} catch (e) {
  log('VERIFY_RESULT: FAIL — driver error: ' + String(e));
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
  log('app closed.');
}
