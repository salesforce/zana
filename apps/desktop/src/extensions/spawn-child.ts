/**
 * The Electron-coupled transport for `ExtensionProcessHost` (P3-A): forks the
 * core-owned child bootstrap (`host-child`) in a `utilityProcess` and wires a
 * `MessageChannelMain` so host and child speak the `host-protocol` JSON-RPC over
 * a dedicated data port (keeping `parentPort` free for the one-time handoff).
 *
 * Kept apart from `process-host.ts` so that file stays Electron-free + unit-
 * testable with a mock endpoint. This is the ONLY part of P3-A that touches
 * `utilityProcess`, so it isn't exercised by vitest (no real child in CI) — the
 * routing/timeout/teardown/crash logic it feeds IS unit-tested via the mock.
 */

import { utilityProcess, MessageChannelMain } from 'electron';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import type { ChildEndpoint, SpawnFn } from './process-host.js';
import type { ChildToHost, HostToChild } from './host-protocol.js';
// The env allowlist lives in `@zana-ai/zcc-process-utils` so the brokered
// `ctx.exec` (broker-caps.ts, unit-tested, can't import `electron`) shares the
// SAME allowlist — the two untrusted-child spawn sites must trim env identically.
import { buildChildEnv } from '@zana-ai/zcc-process-utils';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Resolve the built child bootstrap. electron-vite emits the `host-child` entry
 * to the same dir as the main `index.js` (out/main/), so it sits beside this
 * module at runtime.
 */
function childEntryPath(): string {
  return join(__dirname, 'host-child.js');
}

/**
 * Production `SpawnFn`: fork the child, create a MessageChannelMain, give the
 * child port to the child (via parentPort handoff) and keep the host port here.
 */
export const spawnUtilityChild: SpawnFn = (entryPath: string, moduleId: string): ChildEndpoint => {
  // The disk extension's entry + id are passed over the protocol `init` message
  // (not argv) so they can't be confused with the bootstrap's own args. argv
  // carries only a human-readable tag for `ps`/crash logs.
  const child = utilityProcess.fork(childEntryPath(), [`--zcc-ext=${moduleId}`], {
    serviceName: `zcc-ext-${moduleId}`,
    stdio: 'inherit',
    // Isolation finding A: pass an explicit minimal env so the untrusted child
    // does NOT inherit the host's full environment (tokens, API keys, AWS_*…).
    // See CHILD_ENV_ALLOWLIST for the per-var rationale.
    env: buildChildEnv()
  });

  const { port1: hostPort, port2: childPort } = new MessageChannelMain();

  // Hand the child its data port once it's spawned. `utilityProcess` requires
  // the process be alive before postMessage with a transferable.
  child.once('spawn', () => {
    child.postMessage({ type: 'zcc-port' }, [childPort]);
  });

  hostPort.start();

  return {
    postMessage(msg: HostToChild) {
      hostPort.postMessage(msg);
    },
    onMessage(listener: (msg: ChildToHost) => void) {
      hostPort.on('message', (e: { data: ChildToHost }) => listener(e.data));
    },
    onExit(listener: (code: number | null) => void) {
      child.on('exit', (code: number) => listener(code ?? null));
    },
    kill() {
      try {
        hostPort.close();
      } catch {
        /* ignore */
      }
      child.kill();
    }
  };
};
