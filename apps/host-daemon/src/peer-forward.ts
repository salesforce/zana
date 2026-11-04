import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { PeerForwardCommandSchema } from '@zana-ai/zcc-contracts/host-rpc';
import { HostCommandError } from './host-command-error.js';
import { posixPermissions } from './posix-permissions.js';

export const PEER_FORWARD_MAX_BYTES = 8 * 1024 * 1024;
export const PEER_FORWARD_MAX_CONCURRENCY = 4;
export type LocalPeerAppResolver = (signal: AbortSignal) => number | null | Promise<number | null>;

// All enrollment connections share the host's budget, not one budget per remote.
const activeForwards = new Set<AbortController>();

function waitForPeerOperation<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener('abort', abort);
      reject(signal.reason);
    };
    signal.addEventListener('abort', abort, { once: true });
    operation.then(value => {
      signal.removeEventListener('abort', abort);
      resolve(value);
    }, error => {
      signal.removeEventListener('abort', abort);
      reject(error);
    });
    if (signal.aborted) abort();
  });
}

/** Lone surrogates cannot round-trip through UTF-8; avoids an 8 MiB Buffer round trip where `isWellFormed` exists. */
function isWellFormedString(value: string): boolean {
  const native = (value as string & { isWellFormed?: () => boolean }).isWellFormed;
  return typeof native === 'function' ? native.call(value) : Buffer.from(value, 'utf8').toString('utf8') === value;
}

export class PeerForwarder {
  private readonly active = new Map<AbortController, string>();
  private closed = false;

  constructor(private readonly options: {
    resolveLocalPeerApp?: LocalPeerAppResolver;
    fetchFn?: typeof fetch;
  } = {}) {}

  cancelPair(pairId: string): void {
    for (const [controller, pair] of this.active) {
      if (pair === pairId) controller.abort(new HostCommandError('peer_forward_cancelled', 'peer forwarding cancelled'));
    }
  }

  cancelAll(): void {
    for (const controller of this.active.keys()) {
      controller.abort(new HostCommandError('peer_forward_cancelled', 'peer forwarding cancelled'));
    }
  }

  close(): void {
    this.closed = true;
    this.cancelAll();
  }

  async forward(input: unknown, options: { signal?: AbortSignal } = {}): Promise<{ status: number; body: string }> {
    const parsed = PeerForwardCommandSchema.safeParse(input);
    if (!parsed.success) {
      throw new HostCommandError('invalid_request', 'invalid peer forwarding command');
    }
    const command = parsed.data;
    if (Buffer.byteLength(command.body, 'utf8') > PEER_FORWARD_MAX_BYTES) {
      throw new HostCommandError('request_too_large', 'peer request exceeds 8 MiB');
    }
    if (!isWellFormedString(command.body)) {
      throw new HostCommandError('invalid_request', 'invalid peer forwarding command');
    }
    if (this.closed) throw new HostCommandError('peer_forward_closed', 'peer forwarding is closed');
    if (!this.options.resolveLocalPeerApp) throw new HostCommandError('peer_app_unavailable', 'trusted local peer app is unavailable');
    if (options.signal?.aborted) throw new HostCommandError('peer_forward_cancelled', 'peer forwarding cancelled');
    if (activeForwards.size >= PEER_FORWARD_MAX_CONCURRENCY) {
      throw new HostCommandError('peer_forward_busy', 'peer forwarding concurrency limit reached');
    }

    const controller = new AbortController();
    activeForwards.add(controller);
    this.active.set(controller, command.pairId);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const cancelReader = () => { void reader?.cancel().catch(() => {}); };
    controller.signal.addEventListener('abort', cancelReader, { once: true });
    const cancel = () => controller.abort(new HostCommandError('peer_forward_cancelled', 'peer forwarding cancelled'));
    options.signal?.addEventListener('abort', cancel, { once: true });
    const deadline = performance.now() + command.timeoutMs;
    const checkDeadline = () => {
      if (performance.now() >= deadline) {
        controller.abort(new HostCommandError('peer_forward_timeout', 'peer forwarding timed out'));
      }
      if (controller.signal.aborted) throw controller.signal.reason;
    };
    const timer = setTimeout(() => {
      controller.abort(new HostCommandError('peer_forward_timeout', 'peer forwarding timed out'));
    }, command.timeoutMs);
    try {
      const port = await waitForPeerOperation(Promise.resolve(this.options.resolveLocalPeerApp(controller.signal)), controller.signal);
      checkDeadline();
      if (!Number.isInteger(port) || port === null || port < 1024 || port > 65535) {
        throw new HostCommandError('peer_app_unavailable', 'trusted local peer app is unavailable');
      }
      const url = `http://127.0.0.1:${port}${command.route}`;
      const { type: _type, method: _method, body: _body, timeoutMs: _timeout, ...envelope } = command;
      const response = await waitForPeerOperation(
        (this.options.fetchFn ?? fetch)(url, {
          method: 'POST',
          redirect: 'error',
          credentials: 'omit',
          signal: controller.signal,
          headers: {
            'content-type': 'application/json',
            'x-zcc-peer-envelope': Buffer.from(JSON.stringify(envelope)).toString('base64url')
          },
          body: command.body
        }).then(response => {
          // A custom transport may finish after cancellation despite its signal.
          if (controller.signal.aborted) void response.body?.cancel().catch(() => {});
          return response;
        }), controller.signal
      );
      try { checkDeadline(); }
      catch (error) {
        void response.body?.cancel().catch(() => {});
        throw error;
      }
      if (response.redirected || (response.status >= 300 && response.status < 400) || response.url !== url) {
        void response.body?.cancel().catch(() => {});
        throw new HostCommandError('peer_target_mismatch', 'peer response target or redirect is invalid');
      }
      if (response.status < 100 || response.status > 599) {
        void response.body?.cancel().catch(() => {});
        throw new HostCommandError('peer_response_invalid', 'invalid peer response');
      }
      if (!response.body) return { status: response.status, body: '' };
      reader = response.body.getReader();
      // Fetch yields decompressed bytes; the running total bounds memory without preallocating the cap.
      const chunks: Uint8Array[] = [];
      let length = 0;
      for (;;) {
        const chunk = await waitForPeerOperation(reader.read(), controller.signal);
        checkDeadline();
        if (chunk.done) break;
        if (chunk.value.byteLength > PEER_FORWARD_MAX_BYTES - length) {
          throw new HostCommandError('response_too_large', 'peer response exceeds 8 MiB');
        }
        chunks.push(chunk.value);
        length += chunk.value.byteLength;
      }
      let body: string;
      try { body = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, length)); }
      catch { throw new HostCommandError('peer_response_invalid', 'peer response is not valid UTF-8'); }
      checkDeadline();
      return { status: response.status, body };
    } catch (error) {
      if (controller.signal.aborted) throw controller.signal.reason;
      if (error instanceof HostCommandError) throw error;
      // Transport/resolver exceptions can contain credentials or packet contents.
      throw new HostCommandError('peer_forward_failed', 'peer forwarding failed');
    } finally {
      clearTimeout(timer);
      controller.signal.removeEventListener('abort', cancelReader);
      options.signal?.removeEventListener('abort', cancel);
      void reader?.cancel().catch(() => {});
      reader?.releaseLock();
      this.active.delete(controller);
      activeForwards.delete(controller);
    }
  }
}

const LocalPeerAppSchema = z.object({
  version: z.literal(1),
  port: z.number().int().min(1024).max(65535),
  instanceId: z.string().uuid(),
  pid: z.number().int().positive()
}).strict();
const registrationLanes = new Map<string, Promise<unknown>>();

async function registrationDirectory(dataDir: string, create: boolean): Promise<string> {
  // Only a host-selected local app directory may be supplied, never an RPC path.
  const base = await realpath(dataDir);
  const root = await lstat(base);
  if (!root.isDirectory() || posixPermissions() && (root.uid !== process.getuid!() || (root.mode & 0o022) !== 0)) {
    throw new Error('untrusted local peer app directory');
  }
  const directory = join(base, 'peer-app');
  if (create) await mkdir(directory, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  const info = await lstat(directory);
  if (!info.isDirectory() || posixPermissions() && (info.uid !== root.uid || (info.mode & 0o077) !== 0)) {
    throw new Error('untrusted local peer app registration directory');
  }
  return directory;
}

async function readRegistration(directory: string): Promise<z.infer<typeof LocalPeerAppSchema>> {
  const file = await open(join(directory, 'endpoint.json'), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.nlink !== 1 || info.size > 1024 || posixPermissions() && (info.uid !== process.getuid!() || (info.mode & 0o077) !== 0)) {
      throw new Error('untrusted local peer app registration');
    }
    const bytes = Buffer.alloc(1025);
    let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await file.read(bytes, length, bytes.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > 1024) throw new Error('local peer app registration too large');
    return LocalPeerAppSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length))));
  } finally { await file.close(); }
}

/** Core control needs the verified registration plus its owning app identity. */
export function createStoredLocalPeerControlResolver(dataDir: string): (signal: AbortSignal) => Promise<{ port: number; instanceId: string } | null> {
  return async signal => {
    signal.throwIfAborted();
    try {
      const registration = await readRegistration(await registrationDirectory(dataDir, false));
      process.kill(registration.pid, 0);
      signal.throwIfAborted();
      return { port: registration.port, instanceId: registration.instanceId };
    } catch { return null; }
  };
}

export function createStoredLocalPeerAppResolver(dataDir: string): LocalPeerAppResolver {
  const resolve = createStoredLocalPeerControlResolver(dataDir);
  return async signal => (await resolve(signal))?.port ?? null;
}

async function withRegistrationLane<T>(directory: string, run: () => Promise<T>): Promise<T> {
  const task = (registrationLanes.get(directory) ?? Promise.resolve()).catch(() => {}).then(run);
  registrationLanes.set(directory, task);
  try { return await task; }
  finally { if (registrationLanes.get(directory) === task) registrationLanes.delete(directory); }
}

/** Called by the local app owner after HTTP bind; dispose before releasing that listener. */
export async function registerLocalPeerApp(dataDir: string, app: { port: number; instanceId: string }): Promise<() => Promise<void>> {
  const registration = LocalPeerAppSchema.parse({ ...app, version: 1, pid: process.pid });
  const directory = await registrationDirectory(dataDir, true);
  const file = join(directory, 'endpoint.json');
  await withRegistrationLane(directory, async () => {
    const temporary = join(directory, `endpoint.tmp-${randomUUID()}`);
    try {
      const handle = await open(temporary, 'wx', 0o600);
      try { await handle.writeFile(JSON.stringify(registration)); await handle.sync(); }
      finally { await handle.close(); }
      await rename(temporary, file);
    } finally { await unlink(temporary).catch(() => {}); }
  });
  return () => withRegistrationLane(directory, async () => {
    const current = await readRegistration(await registrationDirectory(dataDir, false)).catch(() => null);
    if (current?.instanceId === registration.instanceId && current.pid === registration.pid && current.port === registration.port) {
      await unlink(file).catch(() => {});
    }
  });
}
