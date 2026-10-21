import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ children: [] as any[], queued: undefined as unknown, queueRequests: [] as any[], pv: 0 }));

vi.mock('electron', () => ({
  utilityProcess: {
    fork: (entry: string) => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { EventEmitter: Emitter } = require('node:events') as typeof import('node:events');
      const child: any = Object.assign(new Emitter(), { entry, pid: 7, kill: () => { child.emit('exit', 0); } });
      child.postMessage = (message: any) => {
        if (message.type === 'start') {
          setImmediate(() => child.emit('message', {
            type: 'ready', protocolVersion: h.pv, url: `http://127.0.0.1/${entry}`, hostId: 'host-1', instanceId: 'inst-1'
          }));
        } else if (message.type === 'request' && message.operation === 'thread-queue-turn') {
          h.queueRequests.push(message);
          setImmediate(() => child.emit('message', h.queued === 'runtime-error'
            ? { type: 'error', protocolVersion: h.pv, id: message.id, message: 'thread store unavailable' }
            : { type: 'result', protocolVersion: h.pv, id: message.id, value: h.queued }));
        } else if (message.type === 'stop') {
          setImmediate(() => child.emit('message', { type: 'stopped', protocolVersion: h.pv }));
        }
      };
      h.children.push(child);
      setImmediate(() => child.emit('spawn'));
      return child;
    }
  }
}));
vi.mock('./enroll-host-utility.js', () => ({ enrollHostUtility: async () => 'host-1' }));

h.pv = (await import('@zana-ai/zcc-contracts/runtime')).SERVER_RUNTIME_PROTOCOL_VERSION;
const { startRuntimeSupervisor } = await import('./runtime-supervisor.js');

afterEach(() => { h.children.length = 0; });

describe('utility-backed runtime supervisor', () => {
  it('queues a thread turn through the server runtime and rejects a malformed reply', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-utility-sup-'));
    vi.stubEnv('ZCC_HOST_ENROLL_TOKEN', 'x'.repeat(32));
    const runtime = await startRuntimeSupervisor({ rendererRoot: dataDir, dataDir, runtimeDir: dataDir });
    try {
      h.queued = { ok: true, queued: true };
      await expect(runtime.queueThreadTurn('thread-1', 'project-1', 'hello')).resolves.toEqual({ ok: true, queued: true });
      expect(h.queueRequests.at(-1)).toMatchObject({ operation: 'thread-queue-turn', threadId: 'thread-1', projectId: 'project-1', text: 'hello' });
      h.queued = { ok: 'yes' };
      await expect(runtime.queueThreadTurn('thread-1', 'project-1', 'hello')).resolves.toEqual({ ok: false, reason: 'invalid thread response' });
      // A request the runtime rejects (error reply, timeout, dead child) resolves ok:false, never throws.
      h.queued = 'runtime-error';
      await expect(runtime.queueThreadTurn('thread-1', 'project-1', 'hello')).resolves.toEqual({ ok: false, reason: 'thread store unavailable' });
    } finally {
      await runtime.close();
      vi.unstubAllEnvs();
    }
  });
});
