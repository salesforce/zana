import { getHost, type ZccDatabase } from '@zana-ai/zcc-db';
import { PeerControlPacketSchema } from '@zana-ai/zcc-contracts/host-rpc';
import type { HostHub } from '../../http/host-hub.js';
import { EnrolledPeerChannels, channelHash } from './enrolled-peer-channels.js';
import { controlKey, sealControl, openControl, EnrollmentOfferSchema, ConsentReplySchema, AcceptedReplySchema, RelinkReplySchema, type ControlInput } from './peer-control-protocol.js';
import { linkCapable, type EnrolledPeerBridge } from './scoped-link-authority.js';

export function createEnrolledPeerBridge(options: { instanceId: string; db: ZccDatabase; hub: HostHub; channels: EnrolledPeerChannels }): EnrolledPeerBridge {
  async function send(hostId: string, remoteId: string, input: ControlInput, signal: AbortSignal): Promise<unknown> {
    signal.throwIfAborted();
    const host = getHost(options.db, hostId), channel = await options.channels.remote(remoteId);
    if (!host || host.destroyedAt || !linkCapable(host.enrollmentCapability) || !channel || channel.capability !== host.enrollmentCapability) {
      throw new Error('mutual enrollment unavailable');
    }
    const session = options.hub.getSession(hostId);
    if (!session) throw new Error('enrolled peer offline');
    const assertEnrollment = async () => {
      signal.throwIfAborted();
      const currentChannel = await options.channels.remote(remoteId), currentHost = getHost(options.db, hostId);
      signal.throwIfAborted();
      if (!currentHost || currentHost.destroyedAt || currentHost.enrollmentCapability !== host.enrollmentCapability ||
        currentHost.hostKeyHash !== host.hostKeyHash || options.hub.getSession(hostId) !== session ||
        !currentChannel || currentChannel.capability !== channel.capability || currentChannel.hostId !== channel.hostId ||
        channelHash(currentChannel) !== channelHash(channel)) throw new Error('peer enrollment changed');
    };
    const key = controlKey(host.hostKeyHash, channelHash(channel));
    try {
      await assertEnrollment();
      const packet = sealControl(input, { senderId: options.instanceId, recipientId: remoteId,
        senderHostId: channel.hostId, recipientHostId: hostId }, key);
      const response = await new Promise<{ status: number; body: string }>((resolve, reject) => {
        const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reason); };
        signal.addEventListener('abort', abort, { once: true });
        const rpc = options.hub.callHostOnlineRpc<{ status: number; body: string }>({ hostId,
          command: { type: 'peer.control', packet, timeoutMs: 15_000 }, timeoutMs: 16_000 });
        void rpc.then(resolve, reject);
        void rpc.then(() => signal.removeEventListener('abort', abort), () => signal.removeEventListener('abort', abort));
        if (signal.aborted) abort();
      });
      await assertEnrollment();
      if (response.status !== 200) throw new Error('peer control rejected');
      const returned = PeerControlPacketSchema.parse(JSON.parse(response.body));
      if (JSON.stringify({ ...returned, sealed: '' }) !== JSON.stringify({ ...packet, sealed: '' })) throw new Error('peer control response mismatch');
      return openControl(returned, key, true);
    } finally { key.fill(0); }
  }
  return {
    async prove(hostId, challenge, signal) {
      if (challenge.senderInstanceId !== options.instanceId || !challenge.recipientInstanceId) throw new Error('peer destination required');
      const result = await send(hostId, challenge.recipientInstanceId, { operation: 'proof', nonce: challenge.nonce }, signal);
      if (!result || typeof result !== 'object' || Object.keys(result).join(',') !== 'sealedProof' || typeof (result as { sealedProof?: unknown }).sealedProof !== 'string') throw new Error('invalid peer proof');
      return result as { sealedProof: string };
    },
    async exchange(hostId, operation, proposal, sealed, signal) {
      const input = operation === 'import' ? { operation, proposal, sealedCredential: Buffer.from(sealed!).toString('base64url') } : { operation, proposal };
      const result = await send(hostId, proposal.remoteInstanceId, input, signal);
      if (!result || typeof result !== 'object' || (result as { accepted?: unknown }).accepted !== true) throw new Error('peer control not accepted');
    },
    async introduce(hostId, { recipientInstanceId, ...input }, signal) {
      const result = await send(hostId, recipientInstanceId, { operation: 'introduction', ...input }, signal);
      if (!result || typeof result !== 'object' || (result as { accepted?: unknown }).accepted !== true) throw new Error('peer introduction not accepted');
    },
    async introductionEnrollment(hostId, { recipientInstanceId, ...input }, signal) {
      const parsed = EnrollmentOfferSchema.safeParse(await send(hostId, recipientInstanceId, input, signal));
      // Never echo a rejected reply: it may carry a one-time code.
      if (!parsed.success) throw new Error('invalid peer enrollment offer');
      return parsed.data;
    },
    async introductionConsent(hostId, { recipientInstanceId, ...input }, signal) {
      const parsed = ConsentReplySchema.safeParse(await send(hostId, recipientInstanceId, input, signal));
      if (!parsed.success) throw new Error('invalid peer consent reply');
      return parsed.data;
    },
    async peerRotate(hostId, { recipientInstanceId, ...input }, signal) {
      const parsed = AcceptedReplySchema.safeParse(await send(hostId, recipientInstanceId, { operation: 'peer.rotate', ...input }, signal));
      if (!parsed.success) throw new Error('invalid peer rotate reply');
      return parsed.data;
    },
    async peerRelink(hostId, { recipientInstanceId, ...input }, signal) {
      const parsed = RelinkReplySchema.safeParse(await send(hostId, recipientInstanceId, { operation: 'peer.relink', ...input }, signal));
      // Never echo a rejected reply: it may carry a one-time Connect code.
      if (!parsed.success) throw new Error('invalid peer relink reply');
      return parsed.data;
    },
    async peerRemove(hostId, { recipientInstanceId, ...input }, signal) {
      const parsed = AcceptedReplySchema.safeParse(await send(hostId, recipientInstanceId, { operation: 'peer.remove', ...input }, signal));
      if (!parsed.success) throw new Error('invalid peer removal reply');
      return parsed.data;
    },
    async useRequest(hostId, { recipientInstanceId, ...input }, signal) {
      const parsed = AcceptedReplySchema.safeParse(await send(hostId, recipientInstanceId, { operation: 'use.request', ...input }, signal));
      if (!parsed.success) throw new Error('invalid peer use reply');
      return parsed.data;
    },
    async useDecision(hostId, { recipientInstanceId, ...input }, signal) {
      const parsed = AcceptedReplySchema.safeParse(await send(hostId, recipientInstanceId, { operation: 'use.decision', ...input }, signal));
      if (!parsed.success) throw new Error('invalid peer use reply');
      return parsed.data;
    }
  };
}
