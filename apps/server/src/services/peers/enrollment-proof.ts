import { createHash, timingSafeEqual } from 'node:crypto';
import { getHost, type ZccDatabase } from '@zana-ai/zcc-db';
import { linkCapable, signMutualEnrollmentProof, type MutualEnrollmentProof } from './scoped-link-authority.js';

/** Trusted daemon supplies its two existing enrollment credentials to local core.
 * Receiving server verifies reciprocal credential against its own Machines DB.
 * Neither a claimed reciprocal flag nor daemon lifetime ID proves app identity. */
export function proveMutualEnrollment(input: {
  db: ZccDatabase; localInstanceId: string; verifiedDestinationInstanceId: string;
  senderInstanceId: string; nonce: string;
  outgoingHostId: string; outgoingHostKey: string;
  reciprocalHostId: string; reciprocalHostKey: string;
}): MutualEnrollmentProof {
  if (input.localInstanceId !== input.verifiedDestinationInstanceId || input.localInstanceId === input.senderInstanceId ||
    typeof input.outgoingHostKey !== 'string' || input.outgoingHostKey.length < 32 || input.outgoingHostKey.length > 256 ||
    typeof input.reciprocalHostKey !== 'string' || input.reciprocalHostKey.length < 32 || input.reciprocalHostKey.length > 256) {
    throw new Error('mutual enrollment destination or credentials invalid');
  }
  const reverse = getHost(input.db, input.reciprocalHostId), hash = createHash('sha256').update(input.reciprocalHostKey).digest('hex');
  if (!reverse || reverse.destroyedAt || !linkCapable(reverse.enrollmentCapability) || !/^[a-f0-9]{64}$/.test(reverse.hostKeyHash) ||
    !timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(reverse.hostKeyHash, 'hex'))) throw new Error('reciprocal enrollment unavailable');
  return signMutualEnrollmentProof({ nonce: input.nonce, senderInstanceId: input.senderInstanceId, recipientInstanceId: input.localInstanceId,
    hostId: input.outgoingHostId, reverseHostId: reverse.id, reverseKeyHash: reverse.hostKeyHash, reverseCapability: reverse.enrollmentCapability },
  createHash('sha256').update(input.outgoingHostKey).digest('hex'));
}
