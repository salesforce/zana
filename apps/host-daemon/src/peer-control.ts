import { createHash, createCipheriv, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { PeerControlCommandSchema, PEER_CONTROL_ROUTE, PEER_CONTROL_MAX_BYTES } from '@zana-ai/zcc-contracts/host-rpc';
import { createStoredLocalPeerControlResolver, ownedByCurrentUser } from './peer-forward.js';
import { HostCommandError } from './host-command-error.js';

const REGISTER_ROUTE = '/api/v1/peer-channel-register';
const MAX_ACTIVE_CONTROL_REQUESTS = 4;
const REGISTRATION_TIMEOUT_MS = 5000;
const active = new Set<AbortController>();
async function enrollmentToken(dataDir: string): Promise<string> {
  const file = await open(join(await realpath(dataDir), 'host-enroll.token'), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await file.stat();
    if (!info.isFile() || !ownedByCurrentUser(info.uid) || (info.mode & 0o077) !== 0 || info.nlink !== 1 || info.size > 512) throw new Error('unsafe local app token');
    const bytes = Buffer.alloc(513); let length = 0;
    while (length < bytes.length) { const read = await file.read(bytes, length, bytes.length - length, null); if (!read.bytesRead) break; length += read.bytesRead; }
    if (length !== info.size) throw new Error('local app token changed');
    const token = bytes.subarray(0, length).toString('utf8').trim(); bytes.fill(0);
    if (token.length < 16) throw new Error('local app token unavailable');
    return token;
  } finally { await file.close(); }
}
function sealRegistration(value: unknown, token: string, instanceId: string): string {
  const key = createHash('sha256').update(token).digest(), iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
  const plain = Buffer.from(JSON.stringify(value));
  try {
    cipher.setAAD(Buffer.from(`${REGISTER_ROUTE}:${instanceId}`));
    const bytes = Buffer.concat([cipher.update(plain), cipher.final()]);
    return Buffer.concat([Buffer.from('ZCP2'), iv, cipher.getAuthTag(), bytes]).toString('base64url');
  } finally { key.fill(0); plain.fill(0); }
}

/** Only an authenticated enrollment connection constructs this object. No caller URL or port. */
export class PeerControlForwarder {
  private remoteId: string | undefined;
  private capability: 'execution' | 'peer.forward' = 'peer.forward';
  private readonly controllers = new Set<AbortController>();
  private readonly completions = new Set<Promise<void>>();
  private closed = false;
  /** expectedRemoteId pins an introduced link to the app it was installed for; a different hello never registers. */
  constructor(private readonly options: { localAppDataDir?: string; hostId: string; hostKey: string; expectedRemoteId?: string }) {}
  async hello(remoteId: string | undefined, capability: 'execution' | 'peer.forward' | undefined): Promise<void> {
    this.remoteId = remoteId; this.capability = capability ?? 'peer.forward';
    if (!remoteId || !this.options.localAppDataDir || !this.linkCapable()) return;
    // Local app may start after its daemon. Forward retries registration before control dispatch.
    try { await this.run(REGISTRATION_TIMEOUT_MS, 'hello', async signal => { const target = await this.target(signal); await this.register(target, signal); }); }
    catch { /* unavailable stays fail-closed; run() already logged the cause */ }
  }
  private async target(signal: AbortSignal): Promise<{ port: number; instanceId: string }> {
    signal.throwIfAborted();
    if (!this.options.localAppDataDir || !this.remoteId || !this.linkCapable()) throw new Error('peer control unavailable');
    const target = await createStoredLocalPeerControlResolver(this.options.localAppDataDir)(signal);
    signal.throwIfAborted();
    if (!target || target.instanceId === this.remoteId) throw new Error('peer control local destination unavailable');
    return target;
  }
  private async post(target: { port: number }, route: string, input: unknown, signal: AbortSignal): Promise<{ status: number; body: string }> {
    signal.throwIfAborted();
    const url = `http://127.0.0.1:${target.port}${route}`;
    const body = JSON.stringify(input);
    if (Buffer.byteLength(body) > PEER_CONTROL_MAX_BYTES + 4096) throw new Error('peer control request too large');
    const response = await fetch(url, { method: 'POST', redirect: 'error', credentials: 'omit', signal,
      headers: { 'content-type': 'application/json' }, body });
    if (response.redirected || response.url !== url || response.status >= 300 && response.status < 400) {
      await response.body?.cancel(); throw new Error('peer control redirect');
    }
    const reader = response.body?.getReader(); const chunks: Uint8Array[] = []; let length = 0;
    try {
      if (reader) for (;;) { const chunk = await reader.read(); if (chunk.done) break;
        length += chunk.value.byteLength; if (length > PEER_CONTROL_MAX_BYTES) throw new Error('peer control response too large');
        chunks.push(chunk.value);
      }
      return { status: response.status, body: new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, length)) };
    } finally { await reader?.cancel().catch(() => {}); reader?.releaseLock(); }
  }
  private async register(target: { port: number; instanceId: string }, signal: AbortSignal): Promise<void> {
    const token = await enrollmentToken(this.options.localAppDataDir!);
    const result = await this.post(target, REGISTER_ROUTE, { sealed: sealRegistration({ remoteInstanceId: this.remoteId,
      hostId: this.options.hostId, hostKey: this.options.hostKey, capability: this.capability }, token, target.instanceId) }, signal);
    if (result.status !== 200) throw new Error('peer channel registration failed');
  }
  /**
   * Execution links always carry sealed control. A forward-only link does so only when it was installed for one
   * pinned app (introduction installer); ordinary forward-only enrollments and the standalone helper never do.
   */
  private linkCapable(): boolean {
    if (this.options.expectedRemoteId === undefined) return this.capability === 'execution';
    return this.remoteId === this.options.expectedRemoteId && (this.capability === 'execution' || this.capability === 'peer.forward');
  }
  async forward(input: unknown): Promise<{ status: number; body: string }> {
    const command = PeerControlCommandSchema.parse(input);
    return this.run(command.timeoutMs, 'forward', async signal => {
      const target = await this.target(signal);
      if (command.packet.senderId !== this.remoteId || command.packet.recipientId !== target.instanceId || command.packet.recipientHostId !== this.options.hostId) {
        throw new Error('peer control destination mismatch');
      }
      await this.register(target, signal);
      return this.post(target, PEER_CONTROL_ROUTE, command.packet, signal);
    });
  }
  private async run<T>(timeoutMs: number, operation: string, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.closed || active.size >= MAX_ACTIVE_CONTROL_REQUESTS) throw new HostCommandError('peer_control_unavailable', 'peer control unavailable');
    const controller = new AbortController(); active.add(controller); this.controllers.add(controller);
    let complete!: () => void;
    const completion = new Promise<void>(resolve => { complete = resolve; });
    this.completions.add(completion);
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try { return await work(controller.signal); }
    catch (error) {
      // Cause stays in the daemon log only; the peer sees the sanitized error.
      console.warn(`[peer-control] ${operation} failed: ${error instanceof Error ? error.message : String(error)}`);
      throw new HostCommandError('peer_control_failed', 'peer control unavailable or not authorized');
    }
    finally {
      clearTimeout(timer); active.delete(controller); this.controllers.delete(controller);
      this.completions.delete(completion); complete();
    }
  }
  cancelAll(): void { for (const controller of this.controllers) controller.abort(); }
  close(): void { this.closed = true; this.cancelAll(); }
  async whenIdle(): Promise<void> { while (this.completions.size) await Promise.all(this.completions); }
}
