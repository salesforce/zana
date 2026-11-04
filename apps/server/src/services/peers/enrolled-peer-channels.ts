import { z } from 'zod';
import { PrivatePeerStorage, PEER_ID, type PeerKeyProvider } from './peer-auth.js';
import { createHash } from 'node:crypto';

export const EnrolledPeerChannelSchema = z.object({ remoteInstanceId: z.string().uuid(), hostId: z.string().uuid(),
  hostKey: z.string().min(32).max(512), capability: z.enum(['execution', 'peer.forward']) }).strict();
export type EnrolledPeerChannel = z.infer<typeof EnrolledPeerChannelSchema>;
const stateSchema = z.object({ instanceId: z.string().regex(PEER_ID), channels: z.array(EnrolledPeerChannelSchema).max(256) }).strict();

/** Local daemon-to-app credential registry. Never exported through plugin or browser APIs. */
export class EnrolledPeerChannels {
  private readonly storage: PrivatePeerStorage<z.infer<typeof stateSchema>>;
  private readonly generations = new Map<string, { hostId: string; keyHash: string; capability: 'execution' | 'peer.forward' }>();
  private readonly registrations = new Map<string, number>();
  private disposed = false;
  constructor(directory: string, instanceId: string, keyProvider: PeerKeyProvider) {
    this.storage = new PrivatePeerStorage(directory, 'channels-v1', keyProvider, instanceId,
      () => ({ instanceId, channels: [] }), value => {
        const state = stateSchema.parse(value);
        if (state.instanceId !== instanceId || state.channels.some(c => c.remoteInstanceId === instanceId) ||
          new Set(state.channels.map(c => c.remoteInstanceId)).size !== state.channels.length) throw new Error('invalid enrolled peer channels');
        return state;
      });
  }
  async register(input: EnrolledPeerChannel): Promise<void> {
    if (this.disposed) throw new Error('peer channels disposed');
    const channel = EnrolledPeerChannelSchema.parse(input);
    // Invalidate synchronous commit guards before the first disk await, including uncertain writes.
    if ((!this.generations.has(channel.remoteInstanceId) && this.generations.size >= 256) ||
      (!this.registrations.has(channel.remoteInstanceId) && this.registrations.size >= 256)) throw new Error('peer channel capacity exceeded');
    const generation = { hostId: channel.hostId, keyHash: channelHash(channel), capability: channel.capability };
    this.generations.set(channel.remoteInstanceId, generation);
    this.registrations.set(channel.remoteInstanceId, (this.registrations.get(channel.remoteInstanceId) ?? 0) + 1);
    try { await this.storage.transaction(async (state, save) => {
      if (channel.remoteInstanceId === state.instanceId) throw new Error('self peer enrollment');
      const previous = state.channels.find(c => c.remoteInstanceId === channel.remoteInstanceId);
      if (previous) state.channels[state.channels.indexOf(previous)] = channel;
      else { if (state.channels.length >= 256) throw new Error('peer channel capacity exceeded'); state.channels.push(channel); }
      await save();
    }); } catch (error) {
      // Only retract our own generation; a concurrent registration's generation stays. The failed write may or may
      // not have landed, so re-read storage (the source of truth) rather than guessing the prior generation.
      if (this.generations.get(channel.remoteInstanceId) === generation) {
        this.generations.delete(channel.remoteInstanceId);
        await this.storage.transaction(async state => {
          const stored = state.channels.find(c => c.remoteInstanceId === channel.remoteInstanceId);
          if (stored && !this.generations.has(channel.remoteInstanceId)) this.generations.set(channel.remoteInstanceId,
            { hostId: stored.hostId, keyHash: channelHash(stored), capability: stored.capability });
        }).catch(() => undefined);
      }
      throw error;
    }
    finally {
      const count = this.registrations.get(channel.remoteInstanceId)! - 1;
      if (count) this.registrations.set(channel.remoteInstanceId, count); else this.registrations.delete(channel.remoteInstanceId);
    }
  }
  async remote(instanceId: string): Promise<EnrolledPeerChannel | null> {
    try { return await this.storage.transaction(async state => {
      for (const remoteId of this.generations.keys()) if (!this.registrations.has(remoteId)) this.generations.delete(remoteId);
      for (const channel of state.channels) if (!this.registrations.has(channel.remoteInstanceId)) this.generations.set(channel.remoteInstanceId,
        { hostId: channel.hostId, keyHash: channelHash(channel), capability: channel.capability });
      return state.channels.find(c => c.remoteInstanceId === instanceId) ?? null;
    }); } catch (error) { this.generations.clear(); throw error; }
  }
  /**
   * Removes a channel only when it is exactly the given enrollment; a newer or foreign channel is left intact.
   * Matching is by host id (fail-safe toward removal); an in-flight registration's newer generation is kept.
   */
  async unregister(remoteInstanceId: string, hostId: string): Promise<boolean> {
    if (this.disposed) throw new Error('peer channels disposed');
    return this.storage.transaction(async (state, save) => {
      const index = state.channels.findIndex(c => c.remoteInstanceId === remoteInstanceId && c.hostId === hostId);
      if (index < 0) return false;
      const keyHash = channelHash(state.channels[index]!);
      state.channels.splice(index, 1);
      const generation = this.generations.get(remoteInstanceId);
      if (generation?.hostId === hostId && (generation.keyHash === keyHash || !this.registrations.has(remoteInstanceId))) {
        this.generations.delete(remoteInstanceId);
      }
      await save();
      return true;
    });
  }
  current(instanceId: string): { hostId: string; keyHash: string; capability: 'execution' | 'peer.forward' } | null {
    if (this.disposed) return null;
    const generation = this.generations.get(instanceId);
    return generation ? { ...generation } : null;
  }
  /** Public identity projection only. hostId is the reciprocal enrollment, not an outbound route. */
  async list(): Promise<Array<{ remoteInstanceId: string; capability: 'execution' | 'peer.forward' }>> {
    return this.storage.transaction(async state => state.channels.map(({ remoteInstanceId, capability }) => ({ remoteInstanceId, capability })));
  }
  dispose(): void { this.disposed = true; this.storage.dispose(); this.generations.clear(); }
  whenIdle(): Promise<void> { return this.storage.whenIdle(); }
}
export const channelHash = (channel: EnrolledPeerChannel): string => createHash('sha256').update(channel.hostKey).digest('hex');
