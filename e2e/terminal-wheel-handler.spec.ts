/**
 * Verifies the custom wheel handler wiring in TerminalView executes on a LIVE
 * terminal: spawning a shell mounts the xterm (the `.term .xterm` DOM only
 * exists once the TerminalView construction effect ran to completion — including
 * term.attachCustomWheelEventHandler — without throwing), and dispatching real
 * wheel events over the terminal viewport does not crash the renderer. This is
 * the runtime half of the fix (the config round-trip is covered by
 * terminal-wheel-toggle.spec.ts).
 *
 * Spawns a shell directly via terminals.create (same home-path caveat + cleanup
 * as project-rail-spawn.spec.ts). We assert the xterm is ATTACHED rather than
 * visible — a background tab's surface is display:none, but the construction
 * effect (and the handler wiring we care about) still ran, and dispatchEvent does
 * not require visibility.
 */
import { test, expect } from './fixtures/app';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('terminal: custom wheel handler is wired and wheel events do not crash', async ({
  app,
}) => {
  const { window } = app;

  const projectDir = mkdtempSync(join(tmpdir(), 'zcc-wheel-proj-'));
  const projectId = await window.evaluate(async (path) => {
    const res = await window.cc.projects.add(path);
    const proj = (res && 'ok' in res ? (res as any).value : res) as { id: string };
    return proj.id;
  }, projectDir);
  expect(projectId).toBeTruthy();

  let sessionId: string | null = null;
  try {
    sessionId = await window.evaluate(async (pid) => {
      const res = await window.cc.terminals.create({ projectId: pid, profile: 'shell' } as any);
      const s = (res && 'ok' in (res as any) ? (res as any).value : res) as { id: string };
      return s.id;
    }, projectId);
    expect(sessionId).toBeTruthy();

    // The xterm DOM must exist — proof the TerminalView construction effect ran
    // to completion, i.e. attachCustomWheelEventHandler was called on a real
    // Terminal without throwing (a throw in the layout effect would abort mount).
    const xterm = window.locator('.term .xterm').first();
    await expect(xterm).toBeAttached({ timeout: 20_000 });
    const viewport = window.locator('.term .xterm-viewport').first();
    await expect(viewport).toBeAttached({ timeout: 10_000 });

    // Dispatch real wheel events over the terminal viewport. The custom handler
    // reads term.buffer.active.type / term.modes.mouseTrackingMode and decides
    // whether to cancel — this exercises that code path live. Must not throw.
    await viewport.dispatchEvent('wheel', { deltaY: -120 });
    await viewport.dispatchEvent('wheel', { deltaY: 120 });

    // Renderer still alive and responsive after the wheel events (no crash).
    const stillAlive = await window.evaluate(
      () => document.querySelector('#root')?.childElementCount ?? 0
    );
    expect(stillAlive).toBeGreaterThan(0);
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
        /* best-effort cleanup */
      }
    }, { pid: projectId, sid: sessionId });
  }
});
