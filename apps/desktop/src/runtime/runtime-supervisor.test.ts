import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createUtilityRuntime, startRuntimeSupervisor, type RuntimeSupervisor } from './runtime-supervisor.js';
import { SERVER_RUNTIME_PROTOCOL_VERSION } from '@zana-ai/zcc-contracts/runtime';
import { TERMINAL_HOST_PROTOCOL_VERSION } from '@zana-ai/zcc-contracts/terminal-execution';

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
    await expect(runtime.relaunchEnrolledHost()).resolves.toEqual({
      ok: false,
      message: 'This session does not run a packaged host daemon'
    });
    await expect(runtime.listProjects()).resolves.toEqual([]);
    await expect(runtime.projectMetadata({ action: 'list', kind: 'followups', projectId: 'p' })).rejects.toThrow('requires the product runtime');
    await expect(runtime.libraryAgent({ action: 'list', projectId: 'p' })).rejects.toThrow('requires the product runtime');
    await expect(runtime.libraryDocument({ action: 'list' })).rejects.toThrow('requires the product runtime');
    // No packaged server-runtime child here ⇒ the ACP thread-liveness probe
    // safe-defaults false (never rejects), so no loopback launch can pass on it.
    await expect(runtime.isThreadLive('thread-1', 'project-1')).resolves.toBe(false);
    await expect(runtime.queueThreadTurn('thread-1', 'project-1', 'hello')).resolves.toEqual({ ok: false, reason: 'runtime-unavailable' });
    // Without the plugin host there is no tool policy decision; main's hook route then denies.
    await expect(runtime.decideToolPolicy({
      invocationId: 'a'.repeat(64), threadId: 'thread-1', projectId: 'project-1', profile: 'claude', toolName: 'Bash', input: {}
    })).rejects.toThrow('plugin host is unavailable');
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
      protocolVersion: TERMINAL_HOST_PROTOCOL_VERSION,
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
    const accepted = await runtime.executeTerminal({
      kind: 'start', protocolVersion: TERMINAL_HOST_PROTOCOL_VERSION, commandId: randomUUID(), sessionId, projectId, launchEpoch: 0,
      deadlineAt: new Date(Date.now() + 10_000).toISOString(),
      launch: {
        argv: [process.execPath, '-e', 'setTimeout(() => {}, 1000)'], cwd: root, env: { PATH: process.env.PATH ?? '' },
        cols: 80, rows: 24, mode: 'local-pty'
      }
    });

    const binding = accepted.find((event) => event.kind === 'accepted')!.binding;
    expect(await runtime.recordTerminalEvent({ kind: 'output', protocolVersion: TERMINAL_HOST_PROTOCOL_VERSION, binding, sessionId, launchEpoch: 0, sequence: 99, data: 'late' })).toBe(true);
    expect(await runtime.recordTerminalEvent({ kind: 'output', protocolVersion: TERMINAL_HOST_PROTOCOL_VERSION, binding, sessionId, launchEpoch: 0, sequence: 99, data: 'duplicate' })).toBe(false);
    expect(await runtime.recordTerminalEvent({ kind: 'output', protocolVersion: TERMINAL_HOST_PROTOCOL_VERSION, binding, sessionId, launchEpoch: 1, sequence: 100, data: 'stale' })).toBe(false);
  });

  it('retries a failed desktop host enroll in the background', () => {
    const source = readFileSync(new URL('./runtime-supervisor.ts', import.meta.url), 'utf8');
    expect(source).toContain('host daemon enroll failed');
    expect(source).toContain('setInterval');
    expect(source).toContain('enrollOnce');
    expect(source).toContain("'relaunch'");
    expect(source).toContain('relaunchEnrolledHost');
  });

  it('passes extraEnv only to the product-server utility, not process.env', () => {
    const source = readFileSync(new URL('./runtime-supervisor.ts', import.meta.url), 'utf8');
    expect(source).toContain('extraEnv');
    expect(source).toContain('server-runtime.js');
    expect(source).not.toMatch(/process\.env\.ZCC_PRODUCT_SERVER_CREDENTIAL\s*=/);
  });

  it('does not assign the product-server credential onto process.env', () => {
    const source = readFileSync(new URL('../host.ts', import.meta.url), 'utf8');
    expect(source).toContain('ZCC_PRODUCT_SERVER_CREDENTIAL');
    expect(source).not.toMatch(/process\.env\.ZCC_PRODUCT_SERVER_CREDENTIAL\s*=/);
    expect(source).toContain('extraEnv');
    expect(source).toContain('delete process.env.ZCC_PRODUCT_SERVER_CREDENTIAL');
  });
});

describe('utility runtime thread-queue-turn mapping', () => {
  it('maps the arguments onto the request message and resolves the reply', async () => {
    const listeners: Array<(message: unknown) => void> = [];
    const posted: any[] = [];
    const child = {
      postMessage: (message: unknown) => { posted.push(message); },
      on: (event: string, listener: (message: unknown) => void) => { if (event === 'message') listeners.push(listener); },
      once: () => undefined,
      kill: () => undefined
    };
    const utility = createUtilityRuntime({ child: child as never, url: 'http://127.0.0.1' });
    const reply = utility.request('thread-queue-turn', 'thread-1', 'project-1', 'hello');
    expect(posted[0]).toMatchObject({
      type: 'request', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, operation: 'thread-queue-turn',
      threadId: 'thread-1', projectId: 'project-1', text: 'hello'
    });
    for (const listener of listeners) {
      listener({ type: 'result', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, id: posted[0].id, value: { ok: true, queued: true } });
    }
    await expect(reply).resolves.toEqual({ ok: true, queued: true });
  });
});
