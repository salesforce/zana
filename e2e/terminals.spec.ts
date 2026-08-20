/**
 * Live terminal I/O lifecycle, asserted on the ordered main→renderer event
 * timeline (gated test tap — e2e/sdk/events.ts + src/main/test-tap.ts).
 *
 * A plain `shell` session is the simplest real pty: no agent, no OSC
 * classification. We create it, write a command, and assert the tap recorded
 * `terminals:onData` (the pty echoed output) and — after close — `terminals:onExit`,
 * in that order, for THIS session. This exercises the same fan-out
 * (`safeSend(IPC.terminals.onData, sessionId, data)` / `onExit`) that every
 * agent lane depends on, with none of an agent binary's timing variance.
 *
 * macOS caveat: the added project lands in the REAL ~/.zcc/projects.json (the
 * app ignores sandbox HOME for ~/.zcc); removed in `finally`.
 */
import { test, expect } from './fixtures/app';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test.use({ e2e: true, initialConfig: { tmuxScope: 'off' } });

test('shell session streams onData then onExit on the live timeline', async ({ app, events }) => {
  const { window } = app;
  const projectDir = mkdtempSync(join(tmpdir(), 'zcc-term-proj-'));

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
    sessionId = await window.evaluate(async (pid) => {
      const res = await window.cc.terminals.create({
        projectId: pid,
        profile: 'shell',
        cols: 80,
        rows: 24,
        title: 'Shell Probe'
      });
      if (!res || !('ok' in res) || !res.ok) {
        throw new Error(`terminal create failed: ${res && 'message' in res ? res.message : JSON.stringify(res)}`);
      }
      return res.value.id;
    }, projectId);
    expect(sessionId).toBeTruthy();

    const forSession = (channel: string) => (e: { channel: string; args: unknown[] }) =>
      e.channel === channel && e.args[0] === sessionId;

    // The shell prompt itself produces output; the first onData for this session
    // proves the pty→renderer data path is live.
    await events.waitForEvent(forSession('terminals:onData'), 15_000);

    // Write a command that produces deterministic output, then read it back off
    // the timeline (not the DOM) — the SDK's whole point.
    const marker = 'ZCC_E2E_MARKER_42';
    await window.evaluate(
      async (args) => {
        const { sid, m } = args as { sid: string; m: string };
        await window.cc.terminals.write(sid, `echo ${m}\n`);
      },
      { sid: sessionId, m: marker }
    );

    const dataHit = await events.waitForEvent(
      (e) => forSession('terminals:onData')(e) && JSON.stringify(e.args).includes(marker),
      15_000
    );
    expect(dataHit.channel).toBe('terminals:onData');

    // Close the session → main emits terminals:onExit for it.
    await window.evaluate(async (sid) => window.cc.terminals.close(sid as string), sessionId);
    const exit = await events.waitForEvent(forSession('terminals:onExit'), 15_000);
    expect(exit.channel).toBe('terminals:onExit');

    // Relative order across the whole timeline: onData preceded onExit.
    events.assertOrder(['terminals:onData', 'terminals:onExit']);
    sessionId = null; // already closed; skip the finally close
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
    try {
      rmSync(projectDir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
});
