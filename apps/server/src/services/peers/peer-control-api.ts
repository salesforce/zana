import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { PeerControlPacketSchema, PEER_CONTROL_ROUTE, PEER_CONTROL_MAX_BYTES } from '@zana-ai/zcc-contracts/host-rpc';
import { getHost } from '@zana-ai/zcc-db';
import { readJsonBody, sendJson } from '../../http/json.js';
import type { ProductHttpContext } from '../../http/product-context.js';
import { unsealPeerBytes } from './peer-auth.js';
import { EnrolledPeerChannelSchema, channelHash } from './enrolled-peer-channels.js';
import { controlKey, ControlInputSchema, enrollmentOffer, openControl, controlResponse, SESSIONLESS_OPERATIONS } from './peer-control-protocol.js';
import { linkCapable, signMutualEnrollmentProof } from './scoped-link-authority.js';
import { BootstrapRejection, handleBootstrapPacket, isBootstrapForm, NOT_CONSENTED, rejectsMutualPacket, type PeerLinksControlPort } from './peer-link-bootstrap.js';

/** `peerLinks` is the invitation-founded link store (W4 wires it into ProductHttpContext). */
type PeerControlContext = ProductHttpContext & { peerLinks?: PeerLinksControlPort };

export const PEER_CHANNEL_REGISTER_ROUTE = '/api/v1/peer-channel-register';
let active = 0;
export async function handlePeerControlApi(req: IncomingMessage, res: ServerResponse, ctx: PeerControlContext): Promise<boolean> {
  if (req.url !== PEER_CONTROL_ROUTE && req.url !== PEER_CHANNEL_REGISTER_ROUTE) return false;
  if (req.method !== 'POST' || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '') ||
    req.headers.origin !== undefined || req.headers['sec-fetch-site'] !== undefined || active >= 8) {
    sendJson(res, 403, { error: 'peer control unavailable' }); return true;
  }
  active++;
  const controller = new AbortController(), cancel = () => controller.abort();
  res.once('close', cancel);
  const timer = setTimeout(() => { controller.abort(); req.destroy(); }, 15_000);
  let key: Buffer | undefined;
  try {
    const body = await readJsonBody(req, PEER_CONTROL_MAX_BYTES + 4096);
    if (req.url === PEER_CHANNEL_REGISTER_ROUTE) {
      const packet = body as { sealed?: unknown };
      if (!packet || Object.keys(packet).join(',') !== 'sealed' || typeof packet.sealed !== 'string' || !/^[A-Za-z0-9_-]+$/.test(packet.sealed) || packet.sealed.length > 8192) throw new Error('invalid registration');
      key = createHash('sha256').update(ctx.enrollToken).digest();
      const plain = unsealPeerBytes(Buffer.from(packet.sealed, 'base64url'), key, `${PEER_CHANNEL_REGISTER_ROUTE}:${ctx.productInstanceId}`);
      try { await ctx.peerChannels.register(EnrolledPeerChannelSchema.parse(JSON.parse(plain.toString('utf8')))); }
      finally { plain.fill(0); }
      sendJson(res, 200, { registered: true }); return true;
    }
    const packet = PeerControlPacketSchema.parse(body);
    if (packet.recipientId !== ctx.productInstanceId) throw new Error('wrong recipient');
    // Pre-consent bootstrap plane: its own allowlist, keys and budgets; never the mutual path or ScopedLinkAuthority.
    if (isBootstrapForm(packet)) {
      if (!ctx.peerLinks) throw new Error('peer links unavailable');
      const peerLinks = ctx.peerLinks;
      try {
        const response = await handleBootstrapPacket(packet, { productInstanceId: ctx.productInstanceId, peerChannels: ctx.peerChannels,
          peerControlReplay: ctx.peerControlReplay, peerLinks }, controller.signal);
        sendJson(res, 200, response);
      } catch (error) {
        if (!(error instanceof BootstrapRejection)) throw error;
        if (!res.destroyed) sendJson(res, error.status === 502 ? 403 : error.status, { error: error.message });
      }
      return true;
    }
    if (rejectsMutualPacket(ctx.peerLinks, packet)) { sendJson(res, 403, { error: NOT_CONSENTED }); return true; }
    const channel = await ctx.peerChannels.remote(packet.senderId), host = getHost(ctx.db, packet.senderHostId);
    if (!channel || !linkCapable(channel.capability) || channel.hostId !== packet.recipientHostId ||
      !host || host.destroyedAt || host.enrollmentCapability !== channel.capability) throw new Error('mutual enrollment missing');
    // The sender's own connector into this app; only the sealed sessionless operations may arrive without it.
    const session = ctx.hostHub.getSession(host.id);
    const assertEnrollment = async () => {
      const currentChannel = await ctx.peerChannels.remote(packet.senderId), currentHost = getHost(ctx.db, host.id);
      controller.signal.throwIfAborted();
      if (!currentHost || currentHost.destroyedAt || currentHost.enrollmentCapability !== host.enrollmentCapability ||
        currentHost.hostKeyHash !== host.hostKeyHash || ctx.hostHub.getSession(host.id) !== session ||
        !currentChannel || currentChannel.capability !== channel.capability || currentChannel.hostId !== channel.hostId ||
        channelHash(currentChannel) !== channelHash(channel)) throw new Error('enrollment changed');
    };
    key = controlKey(channelHash(channel), host.hostKeyHash);
    const input = ControlInputSchema.parse(openControl(packet, key));
    if (!session && !SESSIONLESS_OPERATIONS.has(input.operation)) throw new Error('mutual enrollment missing');
    if (packet.issuedAt <= Date.now() - 60_000 || packet.issuedAt > Date.now() + 10_000 ||
      !await ctx.peerControlReplay.consumeAuthenticated({ pairId: packet.senderHostId, senderId: packet.senderId, epoch: 1,
        nonce: packet.nonce, issuedAt: packet.issuedAt })) throw new Error('peer control replay');
    await assertEnrollment();
    let result: unknown;
    if (input.operation === 'proof') {
      result = signMutualEnrollmentProof({ nonce: input.nonce, senderInstanceId: packet.senderId, recipientInstanceId: ctx.productInstanceId,
        hostId: packet.recipientHostId, reverseHostId: host.id, reverseKeyHash: host.hostKeyHash, reverseCapability: host.enrollmentCapability }, channelHash(channel));
    } else if (input.operation === 'introduction') {
      const { pluginId, scope, peerInstanceId, introductionId } = input;
      // Only a sponsor reached over the link this app founded with it from a first-contact invitation for this plugin
      // relays within the owner's earlier consent, so the remaining-member link is automatic (and marked so). The
      // introduced scope must still be actively granted to the sponsor (`receiveIntroduction`). A sponsor linked by an
      // introduction cannot chain approvals; an execution-enrolled sponsor waits for the owner too.
      const consented = channel.capability === 'peer.forward' &&
        !!await ctx.peerLinks?.foundedFor(packet.senderId, channel.hostId, pluginId).catch(() => false);
      const received = await ctx.peerAuthority.receiveIntroduction(packet.senderId, { pluginId, scope, peerInstanceId, introductionId }, Date.now(),
        { consented });
      if (received?.status === 'approved' && consented) {
        void ctx.peerInstaller?.enroll(received.introductionId).catch(error => {
          console.warn(`[zcc] peer enrollment after relayed introduction failed for ${received.introductionId}: ${error instanceof Error ? error.message : String(error)}`);
        });
      }
      result = { accepted: true };
    } else if (input.operation === 'introduction.enroll') {
      result = await ctx.peerAuthority.relayIntroductionEnrollment(packet.senderId, { introductionId: input.introductionId, ...enrollmentOffer(input) }, controller.signal);
    } else if (input.operation === 'introduction.install') {
      if (!ctx.peerInstaller) throw new Error('peer installer unavailable');
      const { introductionId, pluginId, scope, peerInstanceId } = input;
      result = await ctx.peerInstaller.install(packet.senderId, { introductionId, pluginId, scope, peerInstanceId, ...enrollmentOffer(input) }, controller.signal);
    } else if (input.operation === 'introduction.consent') {
      result = await ctx.peerAuthority.relayIntroductionConsent(packet.senderId, { introductionId: input.introductionId }, controller.signal);
    } else if (input.operation === 'introduction.consented') {
      if (!ctx.peerInstaller) throw new Error('peer installer unavailable');
      const { operation: _operation, ...notice } = input;
      result = await ctx.peerInstaller.peerConsented(packet.senderId, notice);
    } else if (input.operation === 'peer.rotate') {
      // Destination -> peer over the destination's inbound host (the packet's recipient host); forward-only links only.
      if (!ctx.peerLinks || channel.capability !== 'peer.forward' || input.hostId !== packet.recipientHostId) throw new Error('peer link unavailable');
      result = await ctx.peerLinks.acceptRotate(packet.senderId, packet.recipientHostId, { code: input.code, expiresAt: input.expiresAt }, controller.signal);
    } else if (input.operation === 'peer.relink' || input.operation === 'peer.remove') {
      // Linked-link lifecycle, only over peer.forward. The sender host is the host this app minted for the sender.
      if (!ctx.peerLinks || channel.capability !== 'peer.forward' || input.operation === 'peer.relink' && input.hostId !== packet.senderHostId) throw new Error('peer link unavailable');
      result = input.operation === 'peer.relink'
        ? await ctx.peerLinks.acceptRelink(packet.senderId, packet.senderHostId, controller.signal)
        : await ctx.peerLinks.acceptRemoval(packet.senderId, packet.senderHostId, { pairingId: input.pairingId, hostId: input.hostId });
    } else if (input.operation === 'use.request' || input.operation === 'use.decision') {
      // Over the link this app minted for the sender: the sender's own host id (`senderHostId`) is our inbound host.
      if (!ctx.peerUseRequests || channel.capability !== 'peer.forward') throw new Error('peer use unavailable');
      result = input.operation === 'use.request'
        ? await ctx.peerUseRequests.acceptRequest(packet.senderId, packet.senderHostId, { pairingId: input.pairingId, pluginId: input.pluginId })
        : await ctx.peerUseRequests.acceptDecision(packet.senderId, packet.senderHostId, { pairingId: input.pairingId, pluginId: input.pluginId,
          approved: input.approved, ...(input.revoke ? { revoke: true as const } : {}) });
    } else {
      const proposal = input.proposal;
      if (proposal.localInstanceId !== packet.senderId || proposal.remoteInstanceId !== ctx.productInstanceId || proposal.targetHostId !== packet.recipientHostId) throw new Error('proposal destination mismatch');
      const reverse = { ...proposal, localInstanceId: ctx.productInstanceId, remoteInstanceId: packet.senderId, targetHostId: host.id };
      if (input.operation === 'import') await ctx.peerAuthority.import(reverse, Buffer.from(input.sealedCredential, 'base64url'));
      else if (input.operation === 'activate') await ctx.peerAuthority.acceptActivation(reverse);
      else await ctx.peerAuthority.acceptRevocation(reverse);
      result = { accepted: true };
    }
    await assertEnrollment();
    sendJson(res, 200, controlResponse(packet, result, key));
  } catch (error) {
    // Admission, replay and validation failures are indistinguishable by type, so the client still sees 403; the cause is logged (never key material).
    console.warn(`[zcc] peer control request rejected (${req.url}): ${error instanceof Error ? error.message : String(error)}`);
    if (!res.destroyed) sendJson(res, 403, { error: 'peer control unavailable or not authorized' });
  }
  finally { key?.fill(0); clearTimeout(timer); res.off('close', cancel); active--; }
  return true;
}
