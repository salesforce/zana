import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProductRouteSquadRuntime, createSquadMemberRuntimeAdapter, createUtilityRuntime, startRuntimeSupervisor, type RuntimeSupervisor } from './runtime-supervisor.js';
import { SERVER_RUNTIME_PROTOCOL_VERSION } from '@zana-ai/zcc-contracts/runtime';
import { createNativeToolPolicyVerifier } from '@zana-ai/zcc-server/http/native-tool-policy-proof';
import { TERMINAL_HOST_PROTOCOL_VERSION } from '@zana-ai/zcc-contracts/terminal-execution';

let runtime: RuntimeSupervisor | null = null;

afterEach(async () => {
  await runtime?.close();
  runtime = null;
  vi.unstubAllGlobals();
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
    const packIdentity = { marketplaceSource: 'https://catalog.test/marketplace.json', packId: 'team-tools' };
    await expect(runtime.listPluginPacks()).resolves.toEqual([]);
    await expect(runtime.listInstalledPluginPacks()).resolves.toEqual([]);
    await expect(runtime.planPluginPack(packIdentity)).rejects.toThrow('plugin host is unavailable');
    await expect(runtime.installPluginPack({
      identity: packIdentity, planId: randomUUID(), pluginIds: ['team-search']
    })).rejects.toThrow('plugin host is unavailable');
    await expect(runtime.forgetPluginPack(packIdentity)).rejects.toThrow('plugin host is unavailable');
    await expect(runtime.updateAllPlugins()).rejects.toThrow('plugin host is unavailable');
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

describe('main-owned squad runtime adapter', () => {
  const control = { bindingId: '11111111-1111-4111-8111-111111111111', projectId: 'p', generation: 3 };
  const create = { ...control, teamId: 'team', cohortId: '22222222-2222-4222-8222-222222222222', role: 'worker' as const,
    providerId: 'codex', prompt: 'work', title: 'worker' };
  const delivery = { ...control, assignmentId: 'work-1', idempotencyKey: 'send-1', message: 'assignment' };
  const status = { ...control, status: 'active', live: true, hostOnline: true, providerStarted: true, eventSequence: 20, updatedAt: 1 };

  it('validates reserved UUID, generation and every delivery correlation field', async () => {
    const call = vi.fn(async () => ({ threadId: control.bindingId })) as ReturnType<typeof vi.fn>;
    const adapter = createSquadMemberRuntimeAdapter(call);
    await expect(adapter.createSquadMember(create)).resolves.toEqual({ threadId: control.bindingId });
    await expect(adapter.activateSquadMember(create)).resolves.toEqual({ threadId: control.bindingId });
    expect(call).toHaveBeenLastCalledWith('squad-member-activate', create);
    call.mockResolvedValue({ threadId: create.cohortId });
    await expect(adapter.createSquadMember(create)).rejects.toThrow('create correlation');
    await expect(adapter.activateSquadMember(create)).rejects.toThrow('activate correlation');
    const { message: _message, ...correlation } = delivery;
    call.mockResolvedValue({ ...correlation, state: 'uncertain' });
    await expect(adapter.deliverSquadMember(delivery)).resolves.toMatchObject({ state: 'uncertain' });
    for (const field of ['bindingId', 'projectId', 'generation', 'assignmentId', 'idempotencyKey']) {
      call.mockResolvedValue({ ...correlation, state: 'accepted', [field]: field === 'generation' ? 4 : field === 'bindingId' ? create.cohortId : 'wrong' });
      await expect(adapter.deliverSquadMember(delivery)).rejects.toThrow('delivery correlation');
    }
    call.mockResolvedValue(status);
    await expect(adapter.getSquadMemberStatus(control)).resolves.toEqual(status);
    expect(await adapter.isSquadMemberLive(control.bindingId, 'p', 3)).toBe(true);
    for (const patch of [{ generation: 4 }, { projectId: 'other' }, { bindingId: create.cohortId }]) {
      call.mockResolvedValue({ ...status, ...patch });
      expect(await adapter.isSquadMemberLive(control.bindingId, 'p', 3)).toBe(false);
    }
    call.mockResolvedValue(true);
    expect(await adapter.stopSquadMember(control.bindingId, 'p', 3)).toBe(true);
    expect(call).toHaveBeenLastCalledWith('squad-member-stop', control);
    await expect(adapter.stopSquadMember(control.bindingId, 'p', undefined as never)).rejects.toThrow();
  });

  it('validates preflight response host and fail-closed readiness', async () => {
    const hostId = control.bindingId;
    const call = vi.fn(async () => ({ ready: false, hostId, policyInventoryReady: true, nativeToolPolicyRequired: true,
      nativeToolPolicyWired: false, providers: [{ providerId: 'codex', available: true }], reason: 'not wired' }));
    const adapter = createSquadMemberRuntimeAdapter(call);
    expect(await adapter.preflightSquadRuntime({ projectId: 'p', hostId, providerIds: ['codex'] })).toMatchObject({ ready: false });
    await expect(adapter.preflightSquadRuntime({ projectId: 'p', hostId: create.cohortId, providerIds: ['codex'] })).rejects.toThrow('host correlation');
  });

  it('correlates main-settled completion before accepting receipt projection', async () => {
    const { message: _message, ...completion } = delivery;
    const call = vi.fn(async () => ({ ...completion, state: 'completed' }));
    const adapter = createSquadMemberRuntimeAdapter(call);
    await expect(adapter.completeSquadMemberDelivery(completion)).resolves.toEqual({ ...completion, state: 'completed' });
    expect(call).toHaveBeenLastCalledWith('squad-member-delivery-complete', completion);
    for (const field of ['bindingId', 'projectId', 'generation', 'assignmentId', 'idempotencyKey']) {
      call.mockResolvedValue({ ...completion, state: 'completed', [field]: field === 'generation' ? 4 : field === 'bindingId' ? create.cohortId : 'wrong' });
      await expect(adapter.completeSquadMemberDelivery(completion)).rejects.toThrow('completion correlation');
    }
  });

  it('transports generation-bound status/stop and assignment correlation over utility IPC', async () => {
    const listeners: Array<(message: unknown) => void> = [];
    const posted: any[] = [];
    const child = { on: (_event: string, listener: (message: unknown) => void) => { listeners.push(listener); },
      once: () => {}, kill: () => {}, postMessage: (message: any) => {
        posted.push(message);
        for (const listener of listeners) listener({ type: 'result', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, id: message.id, value: true });
      } };
    const utility = createUtilityRuntime({ child: child as never, url: 'http://127.0.0.1:1' });
    await utility.request('squad-member-status', control);
    await utility.request('squad-member-stop', control);
    await utility.request('squad-member-activate', create);
    await utility.request('squad-member-deliver', delivery);
    const { message: _message, ...completion } = delivery;
    await utility.request('squad-member-delivery-complete', completion);
    expect(posted.map(row => ({ operation: row.operation, request: row.request }))).toEqual([
      { operation: 'squad-member-status', request: control }, { operation: 'squad-member-stop', request: control },
      { operation: 'squad-member-activate', request: create },
      { operation: 'squad-member-deliver', request: delivery },
      { operation: 'squad-member-delivery-complete', request: completion }
    ]);
  });

  it('signs development operation body with existing product credential and bounds responses', async () => {
    const secret = 's'.repeat(64), verify = createNativeToolPolicyVerifier(secret);
    const fetcher = vi.fn(async (_url: URL, options: RequestInit) => {
      const proof = (options.headers as Record<string, string>)['x-zcc-native-tool-policy-proof'];
      expect(verify(proof, options.body as string)).toBe(true);
      expect(verify(proof, options.body as string)).toBe(false);
      expect(JSON.parse(options.body as string)).toEqual({ operation: 'squad-member-status', request: control });
      expect(options.redirect).toBe('error');
      return new Response(JSON.stringify({ value: status }));
    });
    vi.stubGlobal('fetch', fetcher);
    const adapter = createProductRouteSquadRuntime({ serverUrl: () => 'http://127.0.0.1:8780', credential: () => secret });
    await expect(adapter.getSquadMemberStatus(control)).resolves.toEqual(status);
    fetcher.mockImplementation(async () => new Response('x'.repeat(65537)));
    await expect(adapter.getSquadMemberStatus(control)).rejects.toThrow('exceeds limit');
    fetcher.mockImplementation(async () => new Response(JSON.stringify({ error: 'stale generation' }), { status: 409 }));
    await expect(adapter.getSquadMemberStatus(control)).rejects.toThrow('stale generation');
    fetcher.mockImplementation(async () => new Response('', { status: 404 }));
    await expect(adapter.getSquadMemberStatus(control)).rejects.toThrow('squad runtime HTTP 404');
    fetcher.mockImplementation(async () => new Response('not json'));
    await expect(adapter.getSquadMemberStatus(control)).rejects.toThrow('invalid squad runtime response');
    await expect(createProductRouteSquadRuntime({ serverUrl: () => 'https://elsewhere', credential: () => secret }).getSquadMemberStatus(control)).rejects.toThrow('loopback');
    await expect(createProductRouteSquadRuntime({ serverUrl: () => 'http://127.0.0.1:8780', credential: () => 'short' }).getSquadMemberStatus(control)).rejects.toThrow('credential');
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
