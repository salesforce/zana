/**
 * Live harness/agent lifecycle, asserted on the ORDERED main→renderer event
 * timeline captured by the gated test tap (see e2e/sdk/events.ts + src/main/test-tap.ts).
 *
 * This is the flagship demonstration of the e2e observability SDK. Instead of
 * polling `agentStatusSnapshot()` after the fact (the shape of
 * agent-status-hydrate.spec.ts), we drive a REAL pty running a controlled fake
 * agent binary (e2e/sdk/harness.ts) and assert the SEQUENCE of `onAgentStatus`
 * pushes and the terminating `onExit` — the thing snapshots can't see.
 *
 * Two harness shapes are covered:
 *   1. claude profile, `work-then-idle`: emits a braille-spinner OSC title
 *      (→ `working`) then a ✳ title (→ `idle`), so the tap records an ordered
 *      working→idle transition on `terminals:onAgentStatus`.
 *   2. claude profile, `work-then-exit`: works briefly then exits, so the tap
 *      records `terminals:onExit` for that session.
 *
 * macOS caveat (same as agent-status-hydrate): the app resolves ~/.zcc via
 * app.getPath('home'), so the added project + `config.set(claudeBinary)` land in
 * the REAL ~/.zcc. The fixture snapshots/restores config.json; we remove the
 * project in `finally`.
 */
import { test, expect } from './fixtures/app';
import { makeFakeAgentBinary } from './sdk/harness';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test.use({ e2e: true });

/** Spawn a claude-profile agent in `projectId` running `binPath`; return session id. */
async function spawnClaude(
  window: import('@playwright/test').Page,
  projectId: string,
  binPath: string,
  title: string
): Promise<string> {
  await window.evaluate((bin) => window.cc.config.set({ claudeBinary: bin }), binPath);
  const sessionId = await window.evaluate(
    async (args) => {
      const { pid, t } = args as { pid: string; t: string };
      const res = await window.cc.terminals.create({
        projectId: pid,
        profile: 'claude',
        cols: 80,
        rows: 24,
        title: t
      });
      const s = (res && 'ok' in res ? (res as { value: { id: string } }).value : res) as {
        id: string;
      };
      return s.id;
    },
    { pid: projectId, t: title }
  );
  expect(sessionId).toBeTruthy();
  return sessionId;
}

test('claude agent lands working→idle on the live onAgentStatus timeline', async ({
  app,
  events
}) => {
  const { window } = app;
  const agent = makeFakeAgentBinary({ profile: 'claude', sequence: 'work-then-idle' });
  const projectDir = mkdtempSync(join(tmpdir(), 'zcc-harness-proj-'));

  const projectId = await window.evaluate(async (path) => {
    const res = await window.cc.projects.add(path);
    const proj = (res && 'ok' in res ? (res as { value: { id: string } }).value : res) as {
      id: string;
    };
    return proj.id;
  }, projectDir);
  expect(projectId).toBeTruthy();

  let sessionId: string | null = null;
  try {
    sessionId = await spawnClaude(window, projectId, agent.path, 'Working Idle Probe');

    // The tracker debounces (~250ms). Wait until we've seen BOTH a working and an
    // idle status push for this session on the live timeline.
    const isForSession = (e: { channel: string; args: unknown[] }, state: string) =>
      e.channel === 'terminals:onAgentStatus' &&
      // onAgentStatus args vary in shape across the codebase; match structurally
      // on the session id + state appearing anywhere in the serialized args.
      JSON.stringify(e.args).includes(sessionId as string) &&
      JSON.stringify(e.args).includes(state);

    await events.waitForEvent((e) => isForSession(e, 'working'), 15_000);
    await events.waitForEvent((e) => isForSession(e, 'idle'), 15_000);

    // Relative-order assertion: working was recorded before idle.
    const statuses = events
      .collect()
      .filter(
        (e) =>
          e.channel === 'terminals:onAgentStatus' &&
          JSON.stringify(e.args).includes(sessionId as string)
      );
    const firstWorking = statuses.findIndex((e) => JSON.stringify(e.args).includes('working'));
    const firstIdle = statuses.findIndex((e) => JSON.stringify(e.args).includes('idle'));
    expect(firstWorking).toBeGreaterThanOrEqual(0);
    expect(firstIdle).toBeGreaterThan(firstWorking);
  } finally {
    await window.evaluate(async (args) => {
      const { pid, sid } = args as { pid: string; sid: string | null };
      try {
        if (sid) await window.cc.terminals.close(sid);
      } catch {
        /* best-effort */
      }
      try {
        await window.cc.projects.remove(pid);
      } catch {
        /* best-effort */
      }
    }, { pid: projectId, sid: sessionId });
    agent.cleanup();
    try {
      rmSync(projectDir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
});

test('agent exit surfaces on the live onExit timeline', async ({ app, events }) => {
  const { window } = app;
  const agent = makeFakeAgentBinary({ profile: 'claude', sequence: 'work-then-exit', exitCode: 0 });
  const projectDir = mkdtempSync(join(tmpdir(), 'zcc-harness-exit-proj-'));

  const projectId = await window.evaluate(async (path) => {
    const res = await window.cc.projects.add(path);
    const proj = (res && 'ok' in res ? (res as { value: { id: string } }).value : res) as {
      id: string;
    };
    return proj.id;
  }, projectDir);
  expect(projectId).toBeTruthy();

  let sessionId: string | null = null;
  try {
    sessionId = await spawnClaude(window, projectId, agent.path, 'Exit Probe');

    // The stub works ~1s then exits(0); main emits terminals:onExit for it.
    const exit = await events.waitForEvent(
      (e) =>
        e.channel === 'terminals:onExit' &&
        JSON.stringify(e.args).includes(sessionId as string),
      15_000
    );
    expect(exit.channel).toBe('terminals:onExit');
  } finally {
    await window.evaluate(async (args) => {
      const { pid, sid } = args as { pid: string; sid: string | null };
      try {
        if (sid) await window.cc.terminals.close(sid);
      } catch {
        /* best-effort */
      }
      try {
        await window.cc.projects.remove(pid);
      } catch {
        /* best-effort */
      }
    }, { pid: projectId, sid: sessionId });
    agent.cleanup();
    try {
      rmSync(projectDir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
});
