import { randomUUID } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createConnection } from 'node:net';
import { z } from 'zod';
import { getConversationThread, getHost, getPrimaryHost, listExecutionHosts } from '@zana-ai/zcc-db';
import { writeSecretFile } from '@zana-ai/zcc-secret-storage';
import { PreviewInputSchema, type PreviewInput, type PreviewList, type PreviewView } from '@zana-ai/zcc-contracts/previews';
import type { ProductHttpContext } from '../../http/product-context.js';
import { MobileConnectionStore } from '../../mobile/connection.js';
import { connectRequest } from '../../mobile/connect-account.js';
import { connectRelay } from '../../../../../services/mobile-relay/client.mjs';
import { isProtectedPreviewPort, protectPreviewPort } from '../../../../../services/mobile-relay/protected-ports.mjs';
import { machinePreviewKey, PREVIEW_TTL, PREVIEW_LIMIT } from '../../../../../services/mobile-relay/preview-policy.mjs';

const LeaseSchema = z.object({ hostId: z.string().max(100), port: z.number().int().min(1024).max(65535), ownerId: z.string().max(100), expiresAt: z.number().int() }).strict();
type Lease = z.infer<typeof LeaseSchema>;
const services = new WeakMap<ProductHttpContext, PreviewService>();
export function previewService(ctx: ProductHttpContext): PreviewService {
  let service = services.get(ctx);
  if (!service) { service = new PreviewService(ctx); services.set(ctx, service); }
  return service;
}
export function disposePreviews(ctx: ProductHttpContext): void { services.get(ctx)?.dispose(); services.delete(ctx); }

export class PreviewService {
  private leases: Lease[] = [];
  private readonly file: string;
  private queue: Promise<unknown> = Promise.resolve();
  private timer: ReturnType<typeof setInterval>;
  private relay?: ReturnType<typeof connectRelay>;
  private signature = '';
  private address: string | null = null;
  private nextAddressCheck = 0;
  private registryError: string | null = null;
  private busy = false;
  private stopped = false;
  private releaseDevPort?: () => void;
  private generation = 0;
  private readonly epoch = randomUUID();
  private readonly remote = new Map<string, { state: string; unavailablePorts: number[]; message?: string }>();
  private readonly knownHosts = new Set<string>();

  constructor(private readonly ctx: ProductHttpContext) {
    this.file = join(ctx.dataDir, 'previews', 'leases.json');
    const devUrl = process.env.ELECTRON_RENDERER_URL;
    if (devUrl) {
      try { const url = new URL(devUrl); if (['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && Number(url.port) > 0) this.releaseDevPort = protectPreviewPort(Number(url.port)); } catch {}
    }
    try {
      if (statSync(this.file).size > 64 * 1024) throw new Error('Preview registry is too large');
      this.leases = z.array(LeaseSchema).max(128).parse(JSON.parse(readFileSync(this.file, 'utf8')));
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.registryError = 'Could not read the saved previews. Repair previews/leases.json before changing shares.'; }
    this.prune();
    this.timer = setInterval(() => { void this.reconcile(); }, 2000);
    this.timer.unref();
    void this.reconcile();
  }

  private connection() { return new MobileConnectionStore(join(this.ctx.dataDir, 'mobile', 'connection.json')).read(); }
  private enabled() {
    try { return !this.stopped && this.ctx.config.getConfig().mobileGatewayEnabled === true && this.connection().mode === 'connect'; }
    catch { return false; }
  }
  private prune() {
    const now = Date.now();
    this.leases = this.leases.filter(lease => {
      if (lease.expiresAt <= now || lease.expiresAt > now + PREVIEW_TTL + 60_000 || !getHost(this.ctx.db, lease.hostId) || getHost(this.ctx.db, lease.hostId)?.destroyedAt) return false;
      if (lease.ownerId === 'operator') return true;
      const thread = getConversationThread(this.ctx.db, lease.ownerId);
      return !!thread && thread.archivedAt === null && thread.hostId === lease.hostId;
    });
  }
  private targets(hostId: string) {
    this.prune();
    if (!this.enabled()) return [];
    const ports = new Map<number, number>();
    for (const lease of this.leases) if (lease.hostId === hostId) ports.set(lease.port, Math.max(ports.get(lease.port) ?? 0, lease.expiresAt));
    return [...ports].map(([port, expiresAt]) => ({ port, expiresAt }));
  }
  private host(input: Pick<PreviewInput, 'hostId'>, ownerId: string) {
    if (ownerId !== 'operator') {
      const thread = getConversationThread(this.ctx.db, ownerId);
      if (!thread || thread.archivedAt !== null || (input.hostId && input.hostId !== thread.hostId)) throw new Error('Preview machine must match this thread');
      return thread.hostId;
    }
    const requested = input.hostId ?? getPrimaryHost(this.ctx.db)?.id;
    const hosts = listExecutionHosts(this.ctx.db);
    const exact = hosts.find(host => host.id === requested);
    const matches = exact ? [exact] : hosts.filter(host => host.name === requested);
    if (matches.length !== 1) throw new Error('Choose a registered machine by its unique name or id');
    return matches[0].id;
  }
  async change(input: PreviewInput, remove = false, ownerId = 'operator'): Promise<PreviewList> {
    input = PreviewInputSchema.parse(input);
    const task = this.queue.then(async () => {
      if (this.registryError) throw new Error(this.registryError);
      if (!remove && !this.enabled()) throw new Error('Turn on Remote access before sharing a preview');
      const hostId = this.host(input, ownerId);
      if (!remove && hostId === getPrimaryHost(this.ctx.db)?.id && this.protected(input.port)) throw new Error('This port belongs to a protected Zana service');
      this.prune();
      const next = this.leases.filter(lease => !(lease.hostId === hostId && lease.port === input.port && (lease.ownerId === ownerId || (remove && ownerId === 'operator'))));
      if (!remove) next.push({ hostId, port: input.port, ownerId, expiresAt: Date.now() + PREVIEW_TTL });
      if (next.length > 128 || new Set(next.filter(lease => lease.hostId === hostId).map(lease => lease.port)).size > PREVIEW_LIMIT) throw new Error('Preview limit reached');
      await writeSecretFile(this.file, JSON.stringify(next));
      this.leases = next;
      this.knownHosts.add(hostId);
    });
    this.queue = task.catch(() => {});
    await task;
    await this.reconcile();
    return this.list(ownerId);
  }

  async list(ownerId = 'operator'): Promise<PreviewList> {
    if (this.registryError) throw new Error(this.registryError);
    this.prune();
    const enabled = this.enabled();
    const primary = getPrimaryHost(this.ctx.db)?.id;
    const scopedHostId = ownerId === 'operator' ? null : this.host({}, ownerId);
    const groups = new Map<string, Lease[]>();
    for (const lease of this.leases) { if (scopedHostId && lease.hostId !== scopedHostId) continue; const key = `${lease.hostId}:${lease.port}`; const group = groups.get(key) ?? []; group.push(lease); groups.set(key, group); }
    const shares = await Promise.all([...groups.values()].map(async leases => {
      const { hostId, port } = leases[0];
      let status: PreviewView['status'] = !enabled ? 'disabled' : 'connecting';
      let message: string | undefined;
      if (enabled && hostId === primary) {
        status = this.relay?.state() === 'connected' ? await this.probe(port) ? 'ready' : 'server-not-responding' : this.relay?.state() === 'update-required' ? 'update-required' : 'connecting';
      } else if (enabled) {
        const remote = this.remote.get(hostId);
        status = !this.ctx.hostHub.connectedHostIds().includes(hostId) ? 'offline' : remote?.state === 'connected' ? remote.unavailablePorts.includes(port) ? 'server-not-responding' : 'ready' : remote?.state === 'update-required' ? 'update-required' : 'connecting';
        message = remote?.message;
      }
      let url: string | null = null;
      if (this.address) {
        const parsed = new URL(this.address);
        const dot = parsed.hostname.indexOf('.');
        parsed.hostname = `${parsed.hostname.slice(0, dot)}--${hostId === primary ? '' : `${machinePreviewKey(hostId)}--`}${port}${parsed.hostname.slice(dot)}`;
        url = parsed.origin;
      }
      return { hostId, hostName: getHost(this.ctx.db, hostId)?.name ?? hostId, port, url, expiresAt: Math.max(...leases.map(lease => lease.expiresAt)), leases: leases.length, status, ...(message ? { message } : {}) };
    }));
    return { enabled, shares };
  }
  private protected(port: number): boolean {
    if (isProtectedPreviewPort(port) || port === this.ctx.origins?.serverPort) return true;
    try { const url = new URL(this.ctx.origins?.appUrl ?? ''); return ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && Number(url.port) === port; }
    catch { return false; }
  }
  private probe(port: number): Promise<boolean> {
    if (this.protected(port)) return Promise.resolve(false);
    return new Promise(resolve => { const socket = createConnection({ host: '127.0.0.1', port }); const done = (value: boolean) => { socket.destroy(); resolve(value); }; socket.setTimeout(300, () => done(false)); socket.once('connect', () => done(true)); socket.once('error', () => done(false)); });
  }
  async reconcile(): Promise<void> {
    if (this.busy || this.stopped) return;
    this.busy = true;
    try {
      this.prune();
      const enabled = this.enabled(), connection = this.connection();
      const primary = getPrimaryHost(this.ctx.db)?.id;
      const signature = enabled ? `${connection.serverId}:${connection.relayToken}` : '';
      if (signature !== this.signature) { this.relay?.close(); this.relay = undefined; this.signature = signature; this.address = null; this.nextAddressCheck = 0; }
      if (enabled && Date.now() >= this.nextAddressCheck) {
        this.nextAddressCheck = Date.now() + 30_000;
        void connectRequest(connection.accountUrl!, '/servers', connection.relayToken, undefined).then(result => {
          if (this.stopped || this.signature !== signature) return;
          const row = Array.isArray(result.servers) ? result.servers.find((item: { id: string }) => item.id === connection.serverId) : undefined;
          const address = typeof row?.browserUrl === 'string' ? new URL(row.browserUrl) : null;
          this.address = address?.protocol === 'https:' && !address.username && !address.password ? address.origin : null;
        }).catch(() => { /* Address lookup cannot interrupt active preview leases. */ });
      }
      if (this.stopped || this.enabled() !== enabled) return;
      if (enabled && primary && this.targets(primary).length && !this.relay) this.relay = connectRelay({ publicUrl: connection.publicUrl!, token: connection.relayToken!, gatewayPort: 1, previews: () => this.targets(primary).filter(target => !this.protected(target.port)) });
      if ((!enabled || !primary || !this.targets(primary).length) && this.relay) { this.relay.close(); this.relay = undefined; }
      for (const lease of this.leases) this.knownHosts.add(lease.hostId);
      // At most 128 leases, at most 32 ports per host. Refresh hosts concurrently
      // so one disconnected machine cannot exhaust another machine's short lease.
      await Promise.all([...this.knownHosts].map(async hostId => {
        if (hostId === primary) { this.knownHosts.delete(hostId); return; }
        if (!this.ctx.hostHub.connectedHostIds().includes(hostId)) {
          if (!this.targets(hostId).length) { this.knownHosts.delete(hostId); this.remote.delete(hostId); }
          return;
        }
        try {
          const result = await this.ctx.hostHub.callHostOnlineRpc<{ state: string; unavailablePorts: number[]; message?: string }>({ hostId, command: { type: 'preview.replace', epoch: this.epoch, generation: ++this.generation, targets: this.targets(hostId) }, timeoutMs: 3000 });
          this.remote.set(hostId, result);
          if (!this.targets(hostId).length) { this.knownHosts.delete(hostId); this.remote.delete(hostId); }
        } catch { this.remote.set(hostId, { state: 'update-required', unavailablePorts: [], message: 'Update or reconnect this execution machine to share previews.' }); }
      }));
    } catch { /* The UI keeps the previous address and reports connecting during account outages. */ }
    finally { this.busy = false; }
  }
  dispose() { this.stopped = true; clearInterval(this.timer); this.releaseDevPort?.(); this.relay?.close(); this.relay = undefined; }
}
