import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ children: [] as any[], pairing: undefined as unknown, pv: 0 }));

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
        } else if (message.type === 'request' && message.operation === 'pairing-target') {
          setImmediate(() => child.emit('message', { type: 'result', protocolVersion: h.pv, id: message.id, value: h.pairing }));
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
  it('serves the pairing target from the server runtime and falls back on a malformed reply', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-utility-sup-'));
    vi.stubEnv('ZCC_HOST_ENROLL_TOKEN', 'x'.repeat(32));
    const runtime = await startRuntimeSupervisor({ rendererRoot: dataDir, dataDir, runtimeDir: dataDir });
    try {
      h.pairing = { kind: 'relay', serverUrl: 'https://relay.example.com' };
      await expect(runtime.pairingTarget()).resolves.toEqual({ kind: 'relay', serverUrl: 'https://relay.example.com' });
      h.pairing = { kind: 'mesh' };
      await expect(runtime.pairingTarget()).resolves.toEqual({ kind: 'tunnel', reason: 'relay_offline' });
    } finally {
      await runtime.close();
      vi.unstubAllEnvs();
    }
  });
});
