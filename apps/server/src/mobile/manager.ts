import { randomBytes } from 'node:crypto';
import { readProductInstanceId } from '../instance-identity.js';
import { mobileDistribution } from './distribution.js';
import type { MobileReadySession } from './readiness.js';
import { ConnectEnrollment, ConnectRequestError, connectRequest, type ConnectFetch } from './connect-account.js';
import { startMobileGateway } from './gateway.js';
import type { MobileDeviceStore } from './device-store.js';
import { MobileConnectionStore, RemovedMobileConnectionError, validateMobileConnection, type MobileConnectionView } from './connection.js';
import { connectRelay, type RelayState } from '../../../../services/mobile-relay/client.mjs';

/** Fixed port the phone and the `mobile:serve` CLI both expect. */
export const MOBILE_GATEWAY_PORT = 8785;

export interface MobileBinding {
  /** Interface the gateway binds — loopback only, reached through the outbound tunnel. */
  host: string;
  /** Exact origin the phone uses; must match the gateway's `Host` check. */
  publicUrl: string;
  /** Compatibility field; always false. LAN listeners are no longer supported. */
  boundLan: boolean;
}

export interface MobileGatewayStatus {
  running: boolean;
  publicUrl: string | null;
  host: string | null;
  port: number | null;
  boundLan: boolean;
  /** Last start failure (e.g. port in use), cleared on a successful start. */
  error: string | null;
  connection?: MobileConnectionView;
  relayState?: RelayState;
  distribution?: ReturnType<typeof mobileDistribution>;
  readySessions?: MobileReadySession[];
}

export interface MobilePairingPayload {
  version: number;
  serverUrl: string;
  code: string;
  expiresAt: number;
}

type GatewayHandle = Awaited<ReturnType<typeof startMobileGateway>>;

export interface MobileGatewayManagerDeps {
  dataDir?: string;
  /** File-backed device store (shared with the `mobile:serve` CLI). */
  devices: MobileDeviceStore;
  /** Loopback product-server origin the gateway proxies to. */
  upstream: string | (() => string);
  port?: number;
  startGateway?: typeof startMobileGateway;
  connectionStore?: MobileConnectionStore;
  connectRelay?: typeof connectRelay;
  connectFetch?: ConnectFetch;
  signQueuedSend?: (threadId: string, itemId: string) => string;
}

/**
 * Owns the desktop-embedded mobile gateway lifecycle (Rule 3: one instance,
 * started/stopped from the config reactor, closed on quit). Thin wrapper over
 * {@link startMobileGateway} so the IPC handlers and `config.ts` stay small;
 * dependencies are injected for tests.
 */
export class MobileGatewayManager {
  private handle: GatewayHandle | null = null;
  private binding: MobileBinding | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private relay: ReturnType<typeof connectRelay> | null = null;
  private readonly connections: MobileConnectionStore;
  private readonly enrollment: ConnectEnrollment;
  private lastError: string | null = null;
  private readonly port: number;
  private readonly startGateway: typeof startMobileGateway;

  constructor(private readonly deps: MobileGatewayManagerDeps) {
    this.port = deps.port ?? MOBILE_GATEWAY_PORT;
    this.connections = deps.connectionStore ?? new MobileConnectionStore();
    this.enrollment = new ConnectEnrollment(deps.connectFetch);
    this.startGateway = deps.startGateway ?? startMobileGateway;
  }

  private serialize<T>(run: () => Promise<T>): Promise<T> {
    const next = this.queue.then(run);
    this.queue = next.catch(() => {});
    return next;
  }

  start(): Promise<MobileGatewayStatus> { return this.serialize(() => this.startNow()); }

  private async startNow(): Promise<MobileGatewayStatus> {
    if (this.handle) return this.status();
    try {
      const connection = this.connections.read();
      if (connection.mode === 'unconfigured') throw new Error('Connect this computer in Settings → Remote access before enabling phone access.');
      const gatewayCredential = connection.mode === 'connect' ? randomBytes(32).toString('base64url') : undefined;
      const binding = {
        host: '127.0.0.1', publicUrl: connection.publicUrl!, boundLan: false
      };
      this.handle = await this.startGateway({
        upstream: typeof this.deps.upstream === 'function' ? this.deps.upstream() : this.deps.upstream, publicUrl: binding.publicUrl,
        host: binding.host, port: this.port, devices: this.deps.devices,
        signQueuedSend: this.deps.signQueuedSend,
        ...(gatewayCredential ? { connectGatewayCredential: gatewayCredential } : {}),
        ...(gatewayCredential && this.deps.dataDir ? { connectInstanceId: readProductInstanceId(this.deps.dataDir) } : {})
      });
      this.binding = binding;
      this.lastError = null;
      if (connection.mode === 'relay' || connection.mode === 'connect') this.relay = (this.deps.connectRelay ?? connectRelay)({
        publicUrl: connection.publicUrl!, token: connection.relayToken!, gatewayPort: this.handle.port,
        ...(gatewayCredential ? { gatewayCredential, ...(this.deps.dataDir ? { productInstanceId: readProductInstanceId(this.deps.dataDir) } : {}) } : {})
      });
    } catch (error) {
      if (this.handle) await this.handle.close();
      this.handle = null;
      this.binding = null;
      this.lastError = (error as NodeJS.ErrnoException)?.code === 'EADDRINUSE'
        ? `Port ${this.port} is already in use — is \`pnpm mobile:serve\` running? Stop it, then enable phone access again.`
        : error instanceof Error ? error.message : 'Failed to start the mobile gateway';
      throw new Error(this.lastError);
    }
    return this.status();
  }

  stop(): Promise<MobileGatewayStatus> { return this.serialize(() => this.stopNow()); }

  private async stopNow(): Promise<MobileGatewayStatus> {
    this.relay?.close();
    this.relay = null;
    const handle = this.handle;
    this.handle = null;
    this.binding = null;
    this.lastError = null;
    if (handle) await handle.close();
    return this.status();
  }

  configure(input: unknown, enabled: boolean): Promise<MobileGatewayStatus> {
    return this.serialize(async () => {
      // A damaged file must not prevent saving a fresh, fully validated setup.
      let previous;
      try { previous = this.connections.read(); } catch { /* no secret to preserve */ }
      const next = validateMobileConnection(input, previous);
      this.enrollment.cancel();
      await this.connections.write(next);
      await this.stopNow();
      return enabled ? this.startNow() : this.status();
    });
  }

  enroll(address: unknown) { return this.serialize(() => this.enrollment.start(address)); }

  redeemComputerCode(address: unknown, code: unknown) {
    return this.serialize(async () => {
      if (this.status().connection?.mode === 'connect') throw new Error('Disconnect this computer before pairing another account');
      const connection = await this.enrollment.redeem(address, code);
      await this.connections.write(connection);
      this.enrollment.cancel();
      await this.stopNow();
      // The caller explicitly enables the shared gateway only after Connect
      // enrollment is stored, so an unpaired switch never exposes a LAN port.
    });
  }

  pollEnrollment(enabled: boolean) {
    return this.serialize(async () => {
      const connection = await this.enrollment.poll();
      if (!connection) return { pending: true };
      await this.connections.write(connection);
      this.enrollment.cancel();
      await this.stopNow();
      if (enabled) await this.startNow();
      return { pending: false };
    });
  }

  cancelEnrollment() { return this.serialize(async () => { this.enrollment.cancel(); }); }

  /** Resolve only this computer's public browser address; credentials stay here. */
  async browserAddress(): Promise<string | null> {
    const connection = this.connections.read();
    if (connection.mode !== 'connect') return null;
    const result = await connectRequest(connection.accountUrl!, '/servers', connection.relayToken, undefined, this.deps.connectFetch);
    if (this.connections.read() !== connection) throw new Error('Connection changed. Refresh the address.');
    if (!Array.isArray(result.servers) || result.servers.length > 500) throw new Error('Invalid computer list');
    const server = result.servers.find(item => item?.id === connection.serverId);
    if (!server || server.revoked) throw new Error('This computer is no longer linked. Sign in again.');
    if (server.serverUrl !== connection.publicUrl) throw new Error('Invalid computer address');
    if (server.browserUrl == null) return null;
    if (typeof server.browserUrl !== 'string' || server.browserUrl.length > 2048) throw new Error('Invalid browser address');
    const url = new URL(server.browserUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Invalid browser address');
    return url.origin;
  }

  disconnectAccount(_enabled: boolean) {
    return this.serialize(async () => {
      const connection = this.connections.read();
      if (connection.mode === 'connect') {
        try { await connectRequest(connection.accountUrl!, '/disconnect', connection.relayToken, {}, this.deps.connectFetch); }
        catch (error) {
          // A credential already removed on the account page is safe to forget.
          // Keep it on transient failures so revocation can still be retried.
          if (!(error instanceof ConnectRequestError) || ![401, 403].includes(error.status)) throw error;
        }
      }
      this.enrollment.cancel();
      await this.connections.write({ mode: 'unconfigured' });
      await this.stopNow();
      // Disconnect stays offline even if an older client leaves the enable flag set.
    });
  }

  status(): MobileGatewayStatus {
    let connection: MobileConnectionView | undefined;
    try { connection = this.connections.view(); } catch (error) {
      this.lastError = error instanceof RemovedMobileConnectionError ? error.message : 'Could not read phone connection configuration';
    }
    return {
      running: !!this.handle,
      publicUrl: this.binding?.publicUrl ?? null,
      host: this.binding?.host ?? null,
      port: this.handle?.port ?? null,
      boundLan: this.binding?.boundLan ?? false,
      error: this.lastError,
      distribution: mobileDistribution(),
      readySessions: this.handle?.readySessions?.() ?? [],
      connection,
      ...(this.relay ? { relayState: this.relay.state() } : {})
    };
  }

  pair(): MobilePairingPayload | Promise<MobilePairingPayload> {
    if (!this.handle) throw new Error('Enable phone access before pairing a device');
    if (this.relay && this.relay.state() !== 'connected') throw new Error('Wait for the relay connection before pairing');
    const connection = this.connections.read();
    if (connection.mode === 'connect') return connectRequest(connection.accountUrl!, '/machine-code', connection.relayToken, {}, this.deps.connectFetch).then(result => {
      if (this.connections.read() !== connection || !this.handle) throw new Error('Connection changed. Generate a fresh pairing code.');
      if (result.version !== 1 || result.serverUrl !== connection.publicUrl || !/^[\w-]{22}$/.test(result.code) || !Number.isFinite(result.expiresAt) || result.expiresAt <= Date.now()) throw new Error('Invalid pairing response');
      return result as MobilePairingPayload;
    });
    return this.handle.pair();
  }

  /** Paired devices, secrets already stripped. Readable even while stopped. */
  devices(): ReturnType<MobileDeviceStore['list']> | Promise<ReturnType<MobileDeviceStore['list']>> {
    const connection = this.connections.read();
    if (connection.mode === 'connect') return connectRequest(connection.accountUrl!, '/devices', connection.relayToken, undefined, this.deps.connectFetch).then(result => {
      if (!Array.isArray(result.devices) || result.devices.length > 500) throw new Error('Invalid device list');
      return result.devices.filter(device => !device.revoked).map(device => {
        if (typeof device.id !== 'string' || typeof device.label !== 'string' || !Number.isFinite(device.createdAt)) throw new Error('Invalid device');
        return { id: device.id, label: device.label, createdAt: device.createdAt, expiresAt: 0 };
      });
    });
    return this.handle ? this.handle.devices() : this.deps.devices.list();
  }

  /** Revoke a paired device; works whether or not the gateway is running. */
  revoke(id: string): boolean | Promise<boolean> {
    if (typeof id !== 'string' || id.length > 80) throw new Error('Invalid device');
    const connection = this.connections.read();
    if (connection.mode === 'connect') return connectRequest(connection.accountUrl!, '/revoke', connection.relayToken, { kind: 'device', id }, this.deps.connectFetch).then(result => result.revoked === true);
    return this.handle ? this.handle.revoke(id) : this.deps.devices.revoke(id);
  }

  async close(): Promise<void> {
    this.enrollment.cancel();
    await this.stop();
  }
}
