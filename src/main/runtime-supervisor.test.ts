import { mkdtempSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startRuntimeSupervisor, type RuntimeSupervisor } from './runtime-supervisor.js';

let runtime: RuntimeSupervisor | null = null;

afterEach(async () => {
  await runtime?.close();
  runtime = null;
});

describe('runtime supervisor', () => {
  it('starts paired loopback renderer and host services with fresh credentials', async () => {
    const root = mkdtempSync(join(tmpdir(), 'zcc-runtime-'));
    writeFileSync(join(root, 'index.html'), '<main>runtime</main>');
    writeFileSync(join(root, 'projects.json'), JSON.stringify({ projects: [{ id: 'project-1' }] }));
    runtime = await startRuntimeSupervisor({ rendererRoot: root });

    expect(runtime.rendererUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    expect(runtime.hostUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(runtime.hostToken).toHaveLength(43);
    expect(runtime.hostSigningKey).toHaveLength(43);
    await expect(runtime.appVersion()).resolves.toBe('');
    await expect(runtime.listProjects()).resolves.toEqual([]);
    await expect(fetch(runtime.rendererUrl).then((response) => response.text())).resolves.toContain('runtime');
    await expect(fetch(`${runtime.hostUrl}/health`).then((response) => response.json())).resolves.toEqual({ ok: true });
  });

  it('executes a local shell terminal through the signed server-host route', async () => {
    const root = mkdtempSync(join(tmpdir(), 'zcc-runtime-'));
    writeFileSync(join(root, 'index.html'), '<main>runtime</main>');
    runtime = await startRuntimeSupervisor({ rendererRoot: root });
    const sessionId = randomUUID();
    const projectId = randomUUID();
    const events: string[] = [];
    const exited = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        off();
        reject(new Error('runtime-host terminal did not exit'));
      }, 5_000);
      const off = runtime!.onTerminalEvent((event) => {
        events.push(event.kind);
        if (event.kind !== 'exited' || event.sessionId !== sessionId) return;
        clearTimeout(timeout);
        off();
        resolve();
      });
    });
    const accepted = await runtime.executeTerminal({
      kind: 'start',
      commandId: randomUUID(),
      sessionId,
      projectId,
      launchEpoch: 0,
      deadlineAt: new Date(Date.now() + 10_000).toISOString(),
      launch: {
        argv: [process.execPath, '-e', 'process.stdout.write("runtime-host-ok")'],
        cwd: root,
        env: { PATH: process.env.PATH ?? '' },
        cols: 80,
        rows: 24,
        mode: 'local-pty'
      }
    });

    expect(accepted).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'accepted', sessionId }),
      expect.objectContaining({ kind: 'started', sessionId })
    ]));
    await exited;
    expect(events).toEqual(expect.arrayContaining(['output', 'exited']));
  });

  it('rejects duplicate host events through the server session authority', async () => {
    const root = mkdtempSync(join(tmpdir(), 'zcc-runtime-'));
    writeFileSync(join(root, 'index.html'), '<main>runtime</main>');
    runtime = await startRuntimeSupervisor({ rendererRoot: root });
    const sessionId = randomUUID();
    const projectId = randomUUID();
    await runtime.executeTerminal({
      kind: 'start', commandId: randomUUID(), sessionId, projectId, launchEpoch: 0,
      deadlineAt: new Date(Date.now() + 10_000).toISOString(),
      launch: {
        argv: [process.execPath, '-e', 'setTimeout(() => {}, 1000)'], cwd: root, env: { PATH: process.env.PATH ?? '' },
        cols: 80, rows: 24, mode: 'local-pty'
      }
    });

    expect(await runtime.recordTerminalEvent({ kind: 'output', sessionId, launchEpoch: 0, sequence: 99, data: 'late' })).toBe(true);
    expect(await runtime.recordTerminalEvent({ kind: 'output', sessionId, launchEpoch: 0, sequence: 99, data: 'duplicate' })).toBe(false);
    expect(await runtime.recordTerminalEvent({ kind: 'output', sessionId, launchEpoch: 1, sequence: 100, data: 'stale' })).toBe(false);
  });
});
