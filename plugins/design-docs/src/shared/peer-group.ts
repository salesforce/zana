export interface GroupMember {
  replicaId: string;
  machineId: string;
  joinedAt: number;
  sponsorReplicaId: string | null;
}

export interface GroupRoster {
  version: 1;
  repoId: string;
  groupId: string;
  genesis: { founders: GroupMember[]; requestId: string; sponsorReplicaId: string };
  seats: Array<{ seat: number; events: SeatEvent[] }>;
  retirements: RetirementEvent[];
  closures: RetirementClosure[];
  removals: RemovalEvent[];
  rosterEpoch: number;
  digest: string;
  members: GroupMember[];
}

export type SeatEvent = {
  seat: number; requestId: string; ownerReplicaId: string; ownerAdmission: string; parent: string; hash: string;
} & ({ kind: 'admit'; member: GroupMember } | {
  kind: 'transfer'; recipientReplicaId: string; recipientAdmission: string;
});

export interface RemovalEvent {
  requestId: string; actorReplicaId: string; actorAdmission: string;
  replicaId: string; admission: string; closure: string; hash: string;
}

export interface RetirementEvent {
  requestId: string; actorReplicaId: string; actorAdmission: string;
  replicaId: string; admission: string; hash: string;
}

export interface RetirementClosure {
  replicaId: string; admission: string; heads: string[]; hash: string;
}

export interface GroupReceipt {
  requestId: string;
  stage: 'joining' | 'retiring' | 'removed';
  roster: GroupRoster;
}

export interface GroupJob {
  id: string;
  peerId: string;
  kind: 'retire' | 'roster' | 'revoke' | 'introduce' | 'local-revoke';
  rosterEpoch: number;
  /** `failed`: a permanent failure hit the retry cap. Terminal like `done`, but kept (with its reason) until Reset. */
  state: 'pending' | 'blocked' | 'done' | 'failed';
  attempts: number;
  error: string | null;
}

/** Why peer lifecycle is unavailable. Codes only; the UI turns them into an actionable sentence. */
export type PeerLifecycleReason = 'encryption-unavailable' | 'insecure-backend' | 'keychain-denied' | 'storage-permissions'
  | 'key-missing' | 'key-corrupt' | 'core-unsupported' | 'unknown';

/** Result of the per-computer Repair action. `detail` is a non-secret sentence for the owner. */
export interface RepairResult {
  outcome: 'already-synced' | 'sync-enabled' | 'relinked' | 'pending' | 'unavailable';
  detail: string | null;
  reason: PeerLifecycleReason | null;
}

export interface GroupStatus {
  configured: boolean;
  repoId: string;
  replicaId: string;
  roster: GroupRoster | null;
  members: Array<GroupMember & { retiring: boolean; connected: boolean; authorized: boolean; grantEpoch: number | null }>;
  jobs: GroupJob[];
  peers: Array<{ id: string; name: string; scope: string; connected: boolean; grantEpoch: number }>;
  enrolled: Array<{ id: string; name: string; connected: boolean }>;
  setup: { peerId: string; repoId: string; state: 'pending' | 'joining'; error: string | null } | null;
  lifecycleAvailable: boolean;
  /** Capability reads are incomplete; no grants are inferred while core refreshes enrollment. */
  lifecycleChecking?: boolean;
  /** Set when `lifecycleAvailable` is false: the real cause, when core reported one. */
  lifecycleReason?: PeerLifecycleReason | null;
  introductionsAvailable: boolean;
  installerAvailable: false;
}

/** Attempts after which a job failing permanently stops retrying and no longer blocks other work (server `finishJob`). */
export const MAX_PERMANENT_JOB_ATTEMPTS = 5;
/** Work that stopped making progress: the owner may discard it with Reset sync. A merely waiting job is not stuck. */
export function stuckJob(job: Pick<GroupJob, 'state' | 'attempts'>): boolean {
  return job.state === 'failed' || (job.state === 'blocked' && job.attempts >= MAX_PERMANENT_JOB_ATTEMPTS);
}
/** Shown instead of a validator or JSON dump (older builds persisted those as job and setup errors). */
export const UNREADABLE_REPLY = 'the other computer sent a reply this computer cannot read; make sure both run the same Design Docs version';
/** Owner-facing form of a stored protocol error: sentences pass through, JSON-looking dumps never do. */
export function ownerText(text: string | null | undefined): string | null {
  if (!text) return null;
  if (/^\s*[[{]/.test(text)) return UNREADABLE_REPLY;
  // Core's wording for "no link to that computer": say what it means instead of the enrollment jargon.
  return /^mutual (?:execution )?enrollment (?:unavailable|missing)$/i.test(text.trim()) ? NOT_CONNECTED : text;
}
/** Core could not verify the other computer because there is no live connection to it right now. */
export const NOT_CONNECTED = 'waiting for the other computer to connect; there is no link to it right now';

/**
 * The one definition of "this computer syncs its database with `peerId`", shared by the computer card badge, Repair and
 * the server: this computer is in a sync group (a roster it left is history), the peer is a current, non-retiring member
 * of it, and core holds exactly one database grant for it.
 */
export function syncedWith(status: Pick<GroupStatus, 'configured' | 'members' | 'replicaId'>, peerId: string): boolean {
  return status.configured && status.members.some((member) => member.replicaId === status.replicaId) &&
    status.members.some((member) => member.machineId === peerId && member.replicaId !== status.replicaId && !member.retiring && member.authorized);
}
