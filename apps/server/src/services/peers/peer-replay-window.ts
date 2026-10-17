import { PEER_ID, PEER_NONCE, PrivatePeerStorage, type PeerKeyProvider } from './peer-auth.js';

export const MAX_PEER_NONCES = 10_000;
export const PEER_REQUEST_TTL_MS = 10 * 60_000;
export const PEER_FUTURE_SKEW_MS = 30_000;

export interface AuthenticatedPeerNonce {
  pairId: string;
  senderId: string;
  epoch: number;
  nonce: string;
  issuedAt: number;
}

export interface PeerReplayState {
  clock: number;
  nonces: AuthenticatedPeerNonce[];
}

export function validateReplayState(value: PeerReplayState): void {
  if (!Number.isSafeInteger(value.clock) || value.clock < 0 || !Array.isArray(value.nonces) || value.nonces.length > MAX_PEER_NONCES) {
    throw new Error('invalid peer replay state');
  }
  const seen = new Set<string>();
  for (const item of value.nonces) {
    if (!validNonce(item) || item.issuedAt > value.clock + PEER_FUTURE_SKEW_MS || seen.has(nonceKey(item))) throw new Error('invalid peer replay state');
    seen.add(nonceKey(item));
  }
}

function validNonce(value: AuthenticatedPeerNonce): boolean {
  return !!value && Object.keys(value).sort().join(',') === 'epoch,issuedAt,nonce,pairId,senderId' &&
    [value.pairId, value.senderId, value.nonce].every((item) => typeof item === 'string') &&
    PEER_ID.test(value.pairId) && PEER_ID.test(value.senderId) && PEER_NONCE.test(value.nonce) &&
    Number.isSafeInteger(value.epoch) && value.epoch > 0 && Number.isSafeInteger(value.issuedAt) && value.issuedAt >= 0;
}

function nonceKey(value: AuthenticatedPeerNonce): string {
  return JSON.stringify([value.pairId, value.senderId, value.epoch, value.nonce]);
}

/** Call only after MAC verification, in the same serialized durable transaction. */
export function consumeAuthenticatedNonce(state: PeerReplayState, input: AuthenticatedPeerNonce, now: number, maxNonces = MAX_PEER_NONCES): boolean {
  if (!validNonce(input) || !Number.isSafeInteger(now) || now < state.clock || input.issuedAt <= now - PEER_REQUEST_TTL_MS ||
    input.issuedAt > now + PEER_FUTURE_SKEW_MS) return false;
  state.nonces = state.nonces.filter((item) => item.issuedAt > now - PEER_REQUEST_TTL_MS);
  if (state.nonces.length >= maxNonces || state.nonces.some((item) => nonceKey(item) === nonceKey(input))) return false;
  state.clock = now;
  state.nonces.push({ ...input });
  return true;
}

export function replayCapacity(value = MAX_PEER_NONCES): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_PEER_NONCES) throw new Error('invalid peer replay capacity');
  return value;
}

/** Standalone host fence. PairStore embeds this state with credentials for atomic auth/revoke. */
export class PeerReplayWindow {
  private readonly storage?: PrivatePeerStorage<PeerReplayState>;
  private readonly now: () => number;
  private readonly capacity: number;
  constructor(options?: { directory: string; localInstanceId: string; keyProvider: PeerKeyProvider; now?: () => number; maxNonces?: number }) {
    this.now = options?.now ?? Date.now;
    this.capacity = replayCapacity(options?.maxNonces);
    if (options) this.storage = new PrivatePeerStorage(options.directory, 'replay-v2', options.keyProvider, options.localInstanceId,
      () => ({ clock: 0, nonces: [] }), (value) => {
        const state = value as PeerReplayState;
        if (!state || Object.keys(state).sort().join(',') !== 'clock,nonces') throw new Error('invalid peer replay state');
        validateReplayState(state);
        return state;
      });
  }

  /** Unsigned legacy calls cannot safely expire or survive restart. Retained only for source compatibility. */
  consume(_pairId: string, _nonce: string, _now = Date.now()): boolean { return false; }

  async consumeAuthenticated(input: AuthenticatedPeerNonce): Promise<boolean> {
    if (!this.storage) throw new Error('durable peer replay storage unavailable');
    const nonce = { ...input };
    return this.storage.transaction(async (state, save) => {
      if (!consumeAuthenticatedNonce(state, nonce, this.now(), this.capacity)) return false;
      await save();
      return true;
    });
  }
  dispose(): void { this.storage?.dispose(); }
  async whenIdle(): Promise<void> { await this.storage?.whenIdle(); }
}
