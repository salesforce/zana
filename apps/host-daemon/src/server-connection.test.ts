import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HOST_RPC_PROTOCOL_VERSION } from '@zana-ai/zcc-contracts/host-rpc';
import { startEnrolledHostConnection } from './server-connection.js';
import type { CommandRuntime } from './command-dispatch.js';

function stubRuntime(dataDir: string): CommandRuntime {
  return {
    dataDir,
    environments: new Map(),
    threads: new Map(),
    terminals: new Map(),
    provisionSignals: new Map(),
    lanes: new Map(),
    loadConfig: () => ({}) as ReturnType<CommandRuntime['loadConfig']>,
    verifyProviders: async () => ({ providers: [] }),
    emit: () => undefined
  };
}

describe('enrolled host websocket', () => {
  const OriginalWebSocket = globalThis.WebSocket;
  afterEach(() => {
    globalThis.WebSocket = OriginalWebSocket;
  });

  it('does not close() from error — Node undici re-enters error and overflows', async () => {
    let closeCalls = 0;
    class RecursiveErrorSocket {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSING = 2;
      static readonly CLOSED = 3;
      readyState = 0;
      private readonly handlers = new Map<string, Array<(event?: unknown) => void>>();
      constructor() {
        queueMicrotask(() => this.dispatch('error'));
      }
      addEventListener(type: string, fn: (event?: unknown) => void) {
        const list = this.handlers.get(type) ?? [];
        list.push(fn);
        this.handlers.set(type, list);
      }
      close() {
        closeCalls += 1;
        if (closeCalls > 20) throw new RangeError('Maximum call stack size exceeded');
        this.dispatch('error');
      }
      send() {}
      dispatch(type: string) {
        for (const fn of this.handlers.get(type) ?? []) fn({ code: 1006 });
      }
    }
    globalThis.WebSocket = RecursiveErrorSocket as unknown as typeof WebSocket;
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-ws-error-'));
    const connection = startEnrolledHostConnection({
      serverUrl: 'http://127.0.0.1:1/',
      hostId: 'host-1',
      hostKey: 'key-1',
      dataDir,
      runtime: stubRuntime(dataDir)
    });
    void connection.ready.catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(closeCalls).toBe(0);
    await connection.close();
  });

  it('rejects ready when the socket closes before hello', async () => {
    class ClosedSocket {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSING = 2;
      static readonly CLOSED = 3;
      readyState = 3;
      addEventListener(type: string, fn: (event?: unknown) => void) {
        if (type === 'close') queueMicrotask(() => fn({ code: 1006 }));
      }
      close() {}
      send() {}
    }
    globalThis.WebSocket = ClosedSocket as unknown as typeof WebSocket;
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-ws-closed-'));
    const connection = startEnrolledHostConnection({
      serverUrl: 'http://127.0.0.1:1/',
      hostId: '11111111-1111-4111-8111-111111111111',
      hostKey: 'key-1',
      dataDir,
      runtime: stubRuntime(dataDir)
    });
    await expect(connection.ready).rejects.toThrow(/closed before hello/);
    await connection.close();
  });

  it('fetches plugin host artifacts through the enrolled HTTP client', () => {
    const source = readFileSync(new URL('./server-connection.ts', import.meta.url), 'utf8');
    expect(source).toContain('createPluginHostArtifactHttpClient');
    expect(source).toContain('fetchPluginHostArtifact');
  });

  it('keeps the pairing session prefix on the host websocket', async () => {
    const opened: string[] = [];
    class CaptureSocket {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSING = 2;
      static readonly CLOSED = 3;
      readyState = 3;
      constructor(url: string) {
        opened.push(String(url));
      }
      addEventListener(type: string, fn: (event?: unknown) => void) {
        if (type === 'close') queueMicrotask(() => fn({ code: 1006 }));
      }
      close() {}
      send() {}
    }
    globalThis.WebSocket = CaptureSocket as unknown as typeof WebSocket;
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-ws-prefix-'));
    const connection = startEnrolledHostConnection({
      serverUrl: 'https://zcc.example/t/zcrs_abcdefghijklmnopqr',
      hostId: '11111111-1111-4111-8111-111111111111',
      hostKey: 'key-1',
      dataDir,
      runtime: stubRuntime(dataDir)
    });
    await expect(connection.ready).rejects.toThrow(/closed before hello/);
    expect(opened[0]).toContain('/t/zcrs_abcdefghijklmnopqr/internal/hosts/ws');
    await connection.close();
  });

  it('resolves ready only after host.hello-ok, not on websocket open', async () => {
    const hostId = '11111111-1111-4111-8111-111111111111';
    class HelloOkSocket {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSING = 2;
      static readonly CLOSED = 3;
      readyState = 1;
      private readonly handlers = new Map<string, Array<(event?: unknown) => void>>();
      constructor() {
        queueMicrotask(() => this.dispatch('open'));
      }
      addEventListener(type: string, fn: (event?: unknown) => void) {
        const list = this.handlers.get(type) ?? [];
        list.push(fn);
        this.handlers.set(type, list);
      }
      send(data: string) {
        const parsed = JSON.parse(data) as { type?: string; hostId?: string };
        if (parsed.type !== 'host.hello') return;
        queueMicrotask(() => this.dispatch('message', {
          data: JSON.stringify({
            type: 'host.hello-ok',
            protocolVersion: HOST_RPC_PROTOCOL_VERSION,
            hostId: parsed.hostId
          })
        }));
      }
      close() {}
      dispatch(type: string, event?: unknown) {
        for (const fn of this.handlers.get(type) ?? []) fn(event ?? { code: 1000 });
      }
    }
    globalThis.WebSocket = HelloOkSocket as unknown as typeof WebSocket;
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-ws-hello-ok-'));
    const connection = startEnrolledHostConnection({
      serverUrl: 'http://127.0.0.1:1/',
      hostId,
      hostKey: 'key-1',
      dataDir,
      runtime: stubRuntime(dataDir)
    });
    await expect(connection.ready).resolves.toBeUndefined();
    await connection.close();
  });

  it('does not mark ready on websocket open before hello-ok', async () => {
    class OpenOnlySocket {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSING = 2;
      static readonly CLOSED = 3;
      readyState = 1;
      private readonly handlers = new Map<string, Array<(event?: unknown) => void>>();
      constructor() {
        queueMicrotask(() => this.dispatch('open'));
      }
      addEventListener(type: string, fn: (event?: unknown) => void) {
        const list = this.handlers.get(type) ?? [];
        list.push(fn);
        this.handlers.set(type, list);
      }
      send() {}
      close() {}
      dispatch(type: string, event?: unknown) {
        for (const fn of this.handlers.get(type) ?? []) fn(event ?? { code: 1000 });
      }
    }
    globalThis.WebSocket = OpenOnlySocket as unknown as typeof WebSocket;
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-ws-open-only-'));
    const connection = startEnrolledHostConnection({
      serverUrl: 'http://127.0.0.1:1/',
      hostId: '11111111-1111-4111-8111-111111111111',
      hostKey: 'key-1',
      dataDir,
      runtime: stubRuntime(dataDir)
    });
    const settled = connection.ready.then(() => 'ready', () => 'rejected');
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(await Promise.race([settled, Promise.resolve('waiting')])).toBe('waiting');
    await connection.close();
  });
});
