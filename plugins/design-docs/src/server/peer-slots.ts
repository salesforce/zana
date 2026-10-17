import { z } from 'zod';
import { canonicalJson, canonicalPeerHash, PeerProtocolError } from '../shared/peer-contract.js';
import type { GroupMember, GroupRoster, RemovalEvent, RetirementEvent, RetirementClosure, SeatEvent } from '../shared/peer-group.js';

export const controlId = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/);
export const MAX_SEAT_EVENTS = 16;
const MAX_SEAT_BYTES = 9 * 1024;
const MAX_REMOVAL_BYTES = 1024;
const MAX_RETIREMENT_BYTES = 768;
const MAX_CLOSURE_BYTES = 2 * 1024;
export const MAX_GOVERNANCE_BYTES = 256 * 1024;
const MAX_ENVELOPE_BYTES = 7 * 1024;
const bytes = (value: unknown) => Buffer.byteLength(canonicalJson(value), 'utf8');
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const memberSchema = z.object({ replicaId: controlId, machineId: controlId,
  joinedAt: z.number().int().nonnegative().safe(), sponsorReplicaId: controlId.nullable() }).strict();
const base = { seat: z.number().int().min(1).max(8), requestId: controlId, ownerReplicaId: controlId,
  ownerAdmission: hash, parent: hash, hash };
const eventSchema = z.discriminatedUnion('kind', [
  z.object({ ...base, kind: z.literal('admit'), member: memberSchema }).strict(),
  z.object({ ...base, kind: z.literal('transfer'), recipientReplicaId: controlId, recipientAdmission: hash }).strict()
]);
const retirementSchema = z.object({ requestId: controlId, actorReplicaId: controlId, actorAdmission: hash,
  replicaId: controlId, admission: hash, hash }).strict();
const removalSchema = retirementSchema.extend({ closure: hash }).strict();
const closureSchema = z.object({ replicaId: controlId, admission: hash, heads: z.array(hash).length(8), hash }).strict();
const schema = z.object({ version: z.literal(1), repoId: controlId, groupId: controlId,
  genesis: z.object({ founders: z.array(memberSchema).length(2), requestId: controlId, sponsorReplicaId: controlId }).strict(),
  seats: z.array(z.object({ seat: z.number().int().min(1).max(8), events: z.array(eventSchema).max(MAX_SEAT_EVENTS) }).strict()).length(8),
  retirements: z.array(retirementSchema).max(64), closures: z.array(closureSchema).max(8),
  removals: z.array(removalSchema).max(64), rosterEpoch: z.number().int().positive().safe(), digest: hash,
  members: z.array(memberSchema).max(8) }).strict();

function scope(roster: GroupRoster) { return { version: roster.version, repoId: roster.repoId, groupId: roster.groupId }; }
export function genesisHash(roster: GroupRoster): string { return canonicalPeerHash({ ...scope(roster), genesis: roster.genesis }); }
export function eventHash(roster: GroupRoster, event: Omit<SeatEvent, 'hash'> | Omit<RemovalEvent, 'hash'> | Omit<RetirementEvent, 'hash'> | Omit<RetirementClosure, 'hash'>): string {
  return canonicalPeerHash({ ...scope(roster), event });
}
function fail(message: string): never { throw new PeerProtocolError('invalid', message); }
function controlEventId(roster: GroupRoster, prefix: string, event: unknown): string {
  return `${prefix}-${canonicalPeerHash({ ...scope(roster), event })}`;
}
const ordered = <T extends { hash: string }>(events: T[]) => [...events].sort((a, b) => a.hash < b.hash ? -1 : 1);
export function isRetiring(roster: GroupRoster, replicaId: string): boolean { return roster.retirements.some((event) => event.replicaId === replicaId); }
function state(roster: GroupRoster) {
  const root = genesisHash(roster), members = new Map<string, GroupMember>(), admissions = new Map<string, string>();
  const owners = roster.seats.map(({ seat }) => roster.genesis.founders[seat <= 5 ? 0 : 1]!.replicaId);
  const occupied = new Set([1, 2]), machines = new Set<string>();
  const add = (member: GroupMember, reference: string) => {
    if (members.has(member.replicaId) || machines.has(member.machineId)) fail('duplicate member identity');
    members.set(member.replicaId, member); machines.add(member.machineId); admissions.set(member.replicaId, reference);
  };
  const founders = roster.genesis.founders;
  if (founders[0]!.replicaId === founders[1]!.replicaId) fail('duplicate founder replica identity');
  if (founders[0]!.machineId >= founders[1]!.machineId ||
    !founders.some((member) => member.replicaId === roster.genesis.sponsorReplicaId) ||
    founders.find((member) => member.replicaId === roster.genesis.sponsorReplicaId)!.sponsorReplicaId !== null ||
    founders.find((member) => member.replicaId !== roster.genesis.sponsorReplicaId)!.sponsorReplicaId !== roster.genesis.sponsorReplicaId) fail('invalid governance genesis');
  founders.forEach((member) => add(member, root));
  owners[0] = founders[0]!.replicaId; owners[1] = founders[1]!.replicaId;
  const positions = Array(8).fill(0) as number[], parents = Array(8).fill(root) as string[];
  let pending = roster.seats.reduce((n, seat) => n + seat.events.length, 0);
  for (const seat of roster.seats) {
    if (seat.events.length > MAX_SEAT_EVENTS || bytes(seat.events) > MAX_SEAT_BYTES) {
      throw new PeerProtocolError('limit', 'reserved seat history limit reached');
    }
  }
  if (roster.removals.length > 64) throw new PeerProtocolError('limit', 'group removal limit (64)');
  const requests = new Set<string>();
  while (pending) {
    let progressed = false;
    for (const [index, chain] of roster.seats.entries()) {
      if (chain.seat !== index + 1) fail('noncanonical seat numbering');
      const event = chain.events[positions[index]!];
      if (!event) continue;
      const { hash: stored, ...body } = event;
      if (event.seat !== chain.seat || stored !== eventHash(roster, body) || event.parent !== parents[index] ||
        event.ownerReplicaId !== owners[index] || occupied.has(chain.seat)) fail('invalid seat hash, parent or owner');
      const owner = admissions.get(event.ownerReplicaId);
      if (!owner) continue;
      if (owner !== event.ownerAdmission) fail('owner admission dependency mismatch');
      if (event.kind === 'transfer') {
        const recipient = admissions.get(event.recipientReplicaId);
        if (!recipient) continue;
        if (recipient !== event.recipientAdmission || event.recipientReplicaId === event.ownerReplicaId) fail('recipient admission dependency mismatch');
        owners[index] = event.recipientReplicaId;
      } else {
        if (event.member.sponsorReplicaId !== event.ownerReplicaId || requests.has(event.requestId)) fail('invalid admission sponsor or request');
        requests.add(event.requestId); add(event.member, stored); owners[index] = event.member.replicaId; occupied.add(chain.seat);
      }
      parents[index] = stored; positions[index]!++; pending--; progressed = true;
    }
    if (!progressed) fail('missing or cyclic admission dependency');
  }
  roster.seats.forEach((seat, index) => { if (seat.seat !== index + 1) fail('noncanonical seat numbering'); });
  const retirementKeys = new Set<string>();
  for (const event of roster.retirements) {
    const { hash: stored, requestId, ...identity } = event;
    if (requestId !== controlEventId(roster, 'retire', identity) || retirementKeys.has(requestId) ||
      stored !== eventHash(roster, { requestId, ...identity }) || admissions.get(event.actorReplicaId) !== event.actorAdmission ||
      admissions.get(event.replicaId) !== event.admission) fail('invalid retirement request');
    if (bytes(event) > MAX_RETIREMENT_BYTES) throw new PeerProtocolError('limit', 'retirement byte limit');
    retirementKeys.add(requestId);
  }
  const closures = new Map<string, RetirementClosure>();
  for (const closure of roster.closures) {
    const { hash: stored, ...body } = closure;
    if (closures.has(closure.replicaId) || admissions.get(closure.replicaId) !== closure.admission ||
      !isRetiring(roster, closure.replicaId) || stored !== eventHash(roster, body) || closure.heads.length !== 8) fail('invalid target closure');
    if (bytes(closure) > MAX_CLOSURE_BYTES) throw new PeerProtocolError('limit', 'closure byte limit');
    const captured = new Set([root]);
    for (const [index, seat] of roster.seats.entries()) {
      const head = closure.heads[index]!, end = head === root ? -1 : seat.events.findIndex((event) => event.hash === head);
      if (head !== root && end < 0) fail('missing closure frontier head');
      for (const event of seat.events.slice(0, end + 1)) captured.add(event.hash);
      if (seat.events.some((event, position) => position > end && event.ownerReplicaId === closure.replicaId)) fail('event authored beyond closed frontier');
    }
    for (const [index, seat] of roster.seats.entries()) {
      const end = closure.heads[index] === root ? -1 : seat.events.findIndex((event) => event.hash === closure.heads[index]);
      for (const event of seat.events.slice(0, end + 1)) {
        if (!captured.has(event.ownerAdmission) || (event.kind === 'transfer' && !captured.has(event.recipientAdmission))) fail('closure frontier missing causal dependency');
      }
    }
    // A target cannot close before its own admission dependency exists in the captured prefix.
    if (closure.admission !== root && !roster.seats.some((seat, index) => {
      const admission = seat.events.findIndex((event) => event.hash === closure.admission);
      const end = seat.events.findIndex((event) => event.hash === closure.heads[index]);
      return admission >= 0 && end >= admission;
    })) fail('closure frontier missing target admission');
    closures.set(closure.replicaId, closure);
  }
  const removed = new Set<string>(), removalKeys = new Set<string>();
  for (const event of roster.removals) {
    const { hash: stored, ...body } = event;
    const { requestId: _requestId, ...identity } = body;
    if (event.requestId !== controlEventId(roster, 'remove', identity) || removalKeys.has(event.requestId)) fail('noncanonical removal key');
    if (bytes(event) > MAX_REMOVAL_BYTES) throw new PeerProtocolError('limit', 'removal byte limit');
    if (stored !== eventHash(roster, body) || admissions.get(event.actorReplicaId) !== event.actorAdmission ||
      admissions.get(event.replicaId) !== event.admission || closures.get(event.replicaId)?.hash !== event.closure) fail('invalid removal hash, closure or admission dependency');
    if (!roster.retirements.some((request) => request.actorReplicaId === event.actorReplicaId && request.actorAdmission === event.actorAdmission &&
      request.replicaId === event.replicaId && request.admission === event.admission)) fail('removal requires matching retirement request');
    removed.add(event.replicaId); removalKeys.add(event.requestId);
  }
  if (roster.removals.some((event, index) => index > 0 && event.hash <= roster.removals[index - 1]!.hash)) fail('noncanonical removal order');
  for (const events of [roster.retirements, roster.closures]) {
    if (events.some((event, index) => index > 0 && event.hash <= events[index - 1]!.hash)) fail('noncanonical retirement or closure order');
  }
  // Hold uncertain transfers until the retiring owner's frontier is sealed. Captured delegation survives.
  const fenced = new Set([...removed, ...roster.retirements.map((event) => event.replicaId)]);
  const uncertain = new Set([...fenced].filter((replicaId) => !closures.has(replicaId)));
  const frozen = roster.seats.map((seat, index) => fenced.has(owners[index]!) ||
    (seat.seat > 2 && uncertain.has(founders[seat.seat <= 5 ? 0 : 1]!.replicaId)) ||
    seat.events.some((event) => uncertain.has(event.ownerReplicaId) || (event.kind === 'transfer' && uncertain.has(event.recipientReplicaId))));
  return { members, admissions, owners, occupied, removed, frozen };
}

export function finalizeRoster(roster: GroupRoster): GroupRoster {
  const derived = state(roster);
  const members = [...derived.members.values()].filter((member) => !derived.removed.has(member.replicaId))
    .sort((a, b) => a.replicaId < b.replicaId ? -1 : 1);
  const governance = { ...scope(roster), genesis: roster.genesis, seats: roster.seats, retirements: roster.retirements, closures: roster.closures, removals: roster.removals };
  const value = { ...governance, rosterEpoch: 1 + roster.seats.reduce((n, seat) => n + seat.events.length,
    roster.removals.length + roster.retirements.length + roster.closures.length),
    digest: canonicalPeerHash(governance), members };
  // Merge-closed budgets: 72KiB seats + 48KiB requests + 16KiB seals + 64KiB removals + 7KiB envelope < 256KiB.
  if (bytes({ ...value, seats: roster.seats.map((seat) => ({ ...seat, events: [] })), retirements: [], closures: [], removals: [] }) > MAX_ENVELOPE_BYTES) {
    throw new PeerProtocolError('limit', 'governance envelope byte limit');
  }
  if (bytes(value) > MAX_GOVERNANCE_BYTES) throw new PeerProtocolError('limit', 'group governance exceeds 256KiB');
  return value;
}

export function parseRoster(input: unknown): GroupRoster {
  if (bytes(input) > MAX_GOVERNANCE_BYTES) throw new PeerProtocolError('limit', 'group governance exceeds 256KiB');
  const parsed = schema.parse(input), expected = finalizeRoster(parsed);
  if (canonicalJson(parsed) !== canonicalJson(expected)) fail('governance digest, epoch or member projection mismatch');
  return expected;
}

export function createRoster(repoId: string, groupId: string, founders: GroupMember[], requestId: string, sponsorReplicaId: string): GroupRoster {
  return parseRoster(finalizeRoster({ version: 1, repoId, groupId,
    genesis: { founders: [...founders].sort((a, b) => a.machineId < b.machineId ? -1 : 1), requestId, sponsorReplicaId },
    seats: Array.from({ length: 8 }, (_, index) => ({ seat: index + 1, events: [] })), retirements: [], closures: [], removals: [],
    rosterEpoch: 1, digest: '', members: [] }));
}

export type SeatAction = SeatEvent extends infer E ? E extends SeatEvent ? Omit<E, 'hash' | 'parent' | 'ownerAdmission'> : never : never;
function seatEvent(roster: GroupRoster, body: SeatAction): SeatEvent {
  const chain = roster.seats[body.seat - 1] ?? fail('invalid seat');
  const event = { ...body, ownerAdmission: admissionReference(roster, body.ownerReplicaId),
    parent: chain.events.at(-1)?.hash ?? genesisHash(roster) };
  return { ...event, hash: eventHash(roster, event) } as SeatEvent;
}

export function ownedSeats(roster: GroupRoster, replicaId: string, propose?: (seat: number) => SeatAction): number[] {
  const derived = state(roster);
  if (derived.removed.has(replicaId) || isRetiring(roster, replicaId)) return [];
  return roster.seats.filter((seat, index) => !derived.occupied.has(seat.seat) && !derived.frozen[index] &&
    seat.events.length < MAX_SEAT_EVENTS && bytes(seat.events) < MAX_SEAT_BYTES && derived.owners[index] === replicaId &&
    (!propose || bytes([...seat.events, seatEvent(roster, propose(seat.seat))]) <= MAX_SEAT_BYTES)).map((seat) => seat.seat);
}
export function admissionReference(roster: GroupRoster, replicaId: string): string {
  return state(roster).admissions.get(replicaId) ?? fail('member admission missing');
}
export function historicalMembers(roster: GroupRoster): GroupMember[] { return [...state(roster).members.values()]; }

export function appendSeat(roster: GroupRoster, body: SeatAction): GroupRoster {
  if (isRetiring(roster, body.ownerReplicaId)) throw new PeerProtocolError('invalid', 'seat owner is retiring');
  const chain = roster.seats[body.seat - 1] ?? fail('invalid seat');
  if (chain.events.length >= MAX_SEAT_EVENTS) throw new PeerProtocolError('limit', 'reserved seat history limit reached');
  const event = seatEvent(roster, body);
  const next = { ...roster, seats: roster.seats.map((seat) => seat === chain ?
    { ...seat, events: [...seat.events, event] } : seat) };
  return parseRoster(finalizeRoster(next));
}

export function transferSeat(roster: GroupRoster, ownerReplicaId: string, recipientReplicaId: string, requestId: string): GroupRoster {
  if (isRetiring(roster, ownerReplicaId) || isRetiring(roster, recipientReplicaId)) fail('capacity member is retiring');
  if (!roster.members.some((member) => member.replicaId === recipientReplicaId)) fail('capacity recipient is not a current member');
  const recipientAdmission = admissionReference(roster, recipientReplicaId);
  const seat = ownedSeats(roster, ownerReplicaId, (seat) => ({ kind: 'transfer', seat, requestId, ownerReplicaId,
    recipientReplicaId, recipientAdmission }))[0];
  if (!seat) throw new PeerProtocolError('limit', 'waiting for reserved capacity');
  return appendSeat(roster, { kind: 'transfer', seat, requestId, ownerReplicaId,
    recipientReplicaId, recipientAdmission });
}

export function removeMember(roster: GroupRoster, actorReplicaId: string, replicaId: string): GroupRoster {
  const closure = roster.closures.find((item) => item.replicaId === replicaId) ?? fail('target closure required before removal');
  const identity = { actorReplicaId, actorAdmission: admissionReference(roster, actorReplicaId),
    replicaId, admission: admissionReference(roster, replicaId), closure: closure.hash };
  const event = { ...identity, requestId: controlEventId(roster, 'remove', identity) };
  if (roster.removals.some((prior) => prior.requestId === event.requestId)) return roster;
  return parseRoster(finalizeRoster({ ...roster, removals: ordered([...roster.removals, { ...event, hash: eventHash(roster, event) }]) }));
}

export function completeRetirements(roster: GroupRoster): GroupRoster {
  for (const request of roster.retirements) if (roster.closures.some((closure) => closure.replicaId === request.replicaId)) {
    roster = removeMember(roster, request.actorReplicaId, request.replicaId);
  }
  return roster;
}

/** Terminal senders can relay known requests, their own seal and deterministic completion, never new history. */
export function permitsRetirementCompletion(current: GroupRoster, next: GroupRoster, senderReplicaId: string): boolean {
  return rosterCovers(current, { ...next, closures: [], removals: [] }) &&
    next.closures.every((closure) => closure.replicaId === senderReplicaId || current.closures.some((known) => known.hash === closure.hash));
}

export function retirementEvidence(roster: GroupRoster, known: GroupRoster, senderReplicaId: string): GroupRoster {
  const closures = roster.closures.filter((closure) => closure.replicaId === senderReplicaId || known.closures.some((item) => item.hash === closure.hash));
  return parseRoster(finalizeRoster({ ...roster, closures, removals: roster.removals.filter((event) => closures.some((closure) => closure.hash === event.closure)) }));
}

export function requestRetirement(roster: GroupRoster, actorReplicaId: string, replicaId: string): GroupRoster {
  const identity = { actorReplicaId, actorAdmission: admissionReference(roster, actorReplicaId), replicaId, admission: admissionReference(roster, replicaId) };
  const event = { ...identity, requestId: controlEventId(roster, 'retire', identity) };
  if (roster.retirements.some((prior) => prior.requestId === event.requestId)) return roster;
  return parseRoster(finalizeRoster({ ...roster, retirements: ordered([...roster.retirements, { ...event, hash: eventHash(roster, event) }]) }));
}

/** Only the target's fenced synchronous transaction may create its seal. Current members can relay it. */
export function closeRetirement(roster: GroupRoster, replicaId: string): GroupRoster {
  if (!isRetiring(roster, replicaId)) fail('target retirement request required');
  if (roster.closures.some((closure) => closure.replicaId === replicaId)) return roster;
  const body = { replicaId, admission: admissionReference(roster, replicaId), heads: roster.seats.map((seat) => seat.events.at(-1)?.hash ?? genesisHash(roster)) };
  return parseRoster(finalizeRoster({ ...roster, closures: ordered([...roster.closures, { ...body, hash: eventHash(roster, body) }]) }));
}

export function rosterCovers(candidate: GroupRoster, required: GroupRoster): boolean {
  return genesisHash(candidate) === genesisHash(required) && required.seats.every((seat, index) =>
    seat.events.every((event, offset) => candidate.seats[index]?.events[offset]?.hash === event.hash)) &&
    required.removals.every((event) => candidate.removals.some((item) => item.hash === event.hash)) &&
    required.retirements.every((event) => candidate.retirements.some((item) => item.hash === event.hash)) &&
    required.closures.every((event) => candidate.closures.some((item) => item.hash === event.hash));
}

export function mergeRosters(local: GroupRoster, incoming: GroupRoster): GroupRoster {
  if (genesisHash(local) !== genesisHash(incoming)) fail('governance genesis changed');
  const seats = local.seats.map((seat, index) => {
    const other = incoming.seats[index]!;
    if (seat.events.some((event, offset) => offset < other.events.length && other.events[offset]!.hash !== event.hash)) {
      throw new PeerProtocolError('conflict', 'forked reserved seat history');
    }
    return other.events.length > seat.events.length ? other : seat;
  });
  const removals = [...new Map([...local.removals, ...incoming.removals].map((event) => [event.hash, event])).values()].sort((a, b) => a.hash < b.hash ? -1 : 1);
  const closures = new Map(local.closures.map((closure) => [closure.replicaId, closure]));
  for (const closure of incoming.closures) {
    if (closures.has(closure.replicaId) && closures.get(closure.replicaId)!.hash !== closure.hash) throw new PeerProtocolError('conflict', 'conflicting target closure');
    closures.set(closure.replicaId, closure);
  }
  const retirements = ordered([...new Map([...local.retirements, ...incoming.retirements].map((event) => [event.hash, event])).values()]);
  return parseRoster(finalizeRoster({ ...local, seats, removals, retirements, closures: ordered([...closures.values()]) }));
}
