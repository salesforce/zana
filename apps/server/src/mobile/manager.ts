import { networkInterfaces } from 'node:os';
import { startMobileGateway } from './gateway.js';
import type { MobileDeviceStore } from './device-store.js';

/** Fixed port the phone and the `mobile:serve` CLI both expect. */
export const MOBILE_GATEWAY_PORT = 8785;

export interface MobileBinding {
  /** Interface the gateway binds — a private LAN IP, else loopback. */
  host: string;
  /** Exact origin the phone uses; must match the gateway's `Host` check. */
  publicUrl: string;
  /** True when bound to a reachable LAN IP (a real phone can connect). */
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
}

export interface MobilePairingPayload {
  version: number;
  serverUrl: string;
  code: string;
  expiresAt: number;
}

type GatewayHandle = Awaited<ReturnType<typeof startMobileGateway>>;

function isPrivateIpv4(address: string): boolean {
  if (address.startsWith('10.') || address.startsWith('192.168.')) return true;
  const second = /^172\.(\d+)\./.exec(address);
  return !!second && Number(second[1]) >= 16 && Number(second[1]) <= 31;
}

/**
 * Prefer a private LAN IPv4 so a phone on the same network can reach the
 * gateway; fall back to loopback (only the simulator / a reverse proxy can
 * reach it then). Binds one specific interface, never `0.0.0.0`.
 */
export function resolveMobileBinding(
  port: number = MOBILE_GATEWAY_PORT,
  interfaces: typeof networkInterfaces = networkInterfaces
): MobileBinding {
  for (const infos of Object.values(interfaces())) {
    for (const info of infos ?? []) {
      if (info.family === 'IPv4' && !info.internal && isPrivateIpv4(info.address))
        return { host: info.address, publicUrl: `http://${info.address}:${port}`, boundLan: true };
    }
  }
  return { host: '127.0.0.1', publicUrl: `http://127.0.0.1:${port}`, boundLan: false };
}

export interface MobileGatewayManagerDeps {
  /** File-backed device store (shared with the `mobile:serve` CLI). */
  devices: MobileDeviceStore;
  /** Loopback product-server origin the gateway proxies to. */
  upstream: string;
  port?: number;
  startGateway?: typeof startMobileGateway;
  resolveBinding?: (port: number) => MobileBinding;
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
  private starting: Promise<void> | null = null;
  private lastError: string | null = null;
  private readonly port: number;
  private readonly startGateway: typeof startMobileGateway;
  private readonly resolveBinding: (port: number) => MobileBinding;

  constructor(private readonly deps: MobileGatewayManagerDeps) {
    this.port = deps.port ?? MOBILE_GATEWAY_PORT;
    this.startGateway = deps.startGateway ?? startMobileGateway;
    this.resolveBinding = deps.resolveBinding ?? resolveMobileBinding;
  }

  async start(): Promise<MobileGatewayStatus> {
    if (this.handle) return this.status();
    if (this.starting) {
      await this.starting;
      return this.status();
    }
    const binding = this.resolveBinding(this.port);
    this.starting = (async () => {
      try {
        this.handle = await this.startGateway({
          upstream: this.deps.upstream,
          publicUrl: binding.publicUrl,
          host: binding.host,
          port: this.port,
          devices: this.deps.devices
        });
        this.binding = binding;
        this.lastError = null;
      } catch (error) {
        this.handle = null;
        this.binding = null;
        const message =
          (error as NodeJS.ErrnoException)?.code === 'EADDRINUSE'
            ? `Port ${this.port} is already in use — is \`pnpm mobile:serve\` running? Stop it, then enable phone access again.`
            : error instanceof Error
              ? error.message
              : 'Failed to start the mobile gateway';
        this.lastError = message;
        throw new Error(message);
      } finally {
        this.starting = null;
      }
    })();
    await this.starting;
    return this.status();
  }

  async stop(): Promise<MobileGatewayStatus> {
    if (this.starting) await this.starting.catch(() => {});
    const handle = this.handle;
    this.handle = null;
    this.binding = null;
    this.lastError = null;
    if (handle) await handle.close();
    return this.status();
  }

  status(): MobileGatewayStatus {
    return {
      running: !!this.handle,
      publicUrl: this.binding?.publicUrl ?? null,
      host: this.binding?.host ?? null,
      port: this.handle?.port ?? null,
      boundLan: this.binding?.boundLan ?? false,
      error: this.lastError
    };
  }

  pair(): MobilePairingPayload {
    if (!this.handle) throw new Error('Enable phone access before pairing a device');
    return this.handle.pair();
  }

  /** Paired devices, secrets already stripped. Readable even while stopped. */
  devices(): ReturnType<MobileDeviceStore['list']> {
    return this.handle ? this.handle.devices() : this.deps.devices.list();
  }

  /** Revoke a paired device; works whether or not the gateway is running. */
  revoke(id: string): boolean {
    return this.handle ? this.handle.revoke(id) : this.deps.devices.revoke(id);
  }

  async close(): Promise<void> {
    await this.stop();
  }
}
