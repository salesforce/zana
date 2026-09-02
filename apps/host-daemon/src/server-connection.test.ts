import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
});
