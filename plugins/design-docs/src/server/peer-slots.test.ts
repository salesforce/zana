import { describe, expect, it } from 'vitest';
import type { GroupMember, GroupRoster } from '../shared/peer-group.js';
import { PeerProtocolError } from '../shared/peer-contract.js';
import { admissionReference, appendSeat, createRoster, eventHash, finalizeRoster, mergeRosters, ownedSeats,
  parseRoster, removeMember, requestRetirement, closeRetirement, isRetiring, rosterCovers, transferSeat } from './peer-slots.js';

const member = (name: string, sponsor: string | null = null): GroupMember => ({ replicaId: name, machineId: `app-${name}`, joinedAt: 1, sponsorReplicaId: sponsor });
const genesis = () => createRoster('db', 'group', [member('a'), member('b', 'a')], 'join-b', 'a');
function admit(roster: GroupRoster, sponsor: string, name: string) {
  return appendSeat(roster, { seat: ownedSeats(roster, sponsor)[0]!, kind: 'admit', requestId: `join-${name}`,
    ownerReplicaId: sponsor, member: member(name, sponsor) });
}
function sealedRemoval(roster: GroupRoster, actor: string, target: string) {
  return removeMember(closeRetirement(requestRetirement(roster, actor, target), target), actor, target);
}

describe('bounded reserved seat governance', () => {
  it('self-leaving founder releases occupied and unused seats without needing its old authority', () => {
    const shared = admit(genesis(), 'b', 'c');
    const removed = sealedRemoval(shared, 'a', 'a');
    expect(ownedSeats(removed, 'b')).toEqual([1, 3, 4, 5, 7, 8]);
    expect(admit(removed, 'b', 'd').members.map((item) => item.replicaId)).toEqual(['b', 'c', 'd']);
  });
  it('later sponsor removal does not invalidate a committed reclaimed-seat admission', () => {
    let roster = admit(genesis(), 'a', 'c');
    roster = sealedRemoval(roster, 'a', 'c');
    roster = admit(roster, 'a', 'd');
    expect(() => sealedRemoval(roster, 'b', 'a')).not.toThrow();
    const removed = sealedRemoval(roster, 'b', 'a');
    expect(removed.members.map((item) => item.replicaId)).toEqual(['b', 'd']);
  });
  it('checkpoint rejects forged hash and stale forks; ancient removed admissions cannot resurrect', () => {
    let roster = genesis();
    const stale = admit(roster, 'a', 'ancient');
    roster = sealedRemoval(stale, 'a', 'ancient');
    for (let index = 0; index < 80; index++) roster = sealedRemoval(admit(roster, 'a', `later-${index}`), 'a', `later-${index}`);
    expect(mergeRosters(roster, stale)).toEqual(roster);
    expect(mergeRosters(stale, roster)).toEqual(roster);
    expect(rosterCovers(roster, stale)).toBe(true);
    expect(rosterCovers(stale, roster)).toBe(false);
    const altered = structuredClone(roster) as GroupRoster & { checkpoint: { hash: string } };
    altered.checkpoint.hash = '0'.repeat(64);
    expect(() => parseRoster(altered)).toThrow(/checkpoint hash/);
    expect(() => mergeRosters(roster, admit(genesis(), 'a', 'fork'))).toThrow(/fork|checkpoint/);
  });
  it('checkpoint fences converge across independent reclaim branches without dropping offline admissions', () => {
    const root = genesis();
    const churn = (sponsor: string, prefix: string) => {
      let roster = root;
      for (let index = 0; index < 9; index++) roster = sealedRemoval(admit(roster, sponsor, `${prefix}-${index}`), sponsor, `${prefix}-${index}`);
      return admit(roster, sponsor, `${prefix}-live`);
    };
    const left = churn('a', 'left'), right = churn('b', 'right');
    const merged = mergeRosters(left, right);
    expect(merged).toEqual(mergeRosters(right, left));
    expect(merged.members.map((item) => item.replicaId)).toEqual(['a', 'b', 'left-live', 'right-live']);
    expect(mergeRosters(merged, root)).toEqual(merged);
    expect(mergeRosters(merged, left)).toEqual(merged);
    expect(parseRoster(merged)).toEqual(merged);
    expect(mergeRosters(mergeRosters(left, root), right)).toEqual(mergeRosters(left, mergeRosters(root, right)));
  });

  it('pending offline founder does not exhaust another seat churn', () => {
    let roster = requestRetirement(admit(genesis(), 'a', 'c'), 'a', 'b');
    for (let index = 0; index < 80; index++) {
      roster = sealedRemoval(admit(roster, 'a', `pending-${index}`), 'a', `pending-${index}`);
      expect(roster.closures.length).toBeLessThanOrEqual(8);
      expect(ownedSeats(roster, 'b')).toEqual([]);
    }
    expect(roster.members.map((item) => item.replicaId)).toEqual(['a', 'b', 'c']);
    const sealed = closeRetirement(roster, 'b');
    expect(removeMember(sealed, 'a', 'b').members.map((item) => item.replicaId)).toEqual(['a', 'c']);
  });
  it('reclaim/refill converges with independent unseen founder admissions in both orders', () => {
    const shared = admit(genesis(), 'a', 'c');
    const offline = admit(shared, 'b', 'offline');
    const removed = sealedRemoval(shared, 'a', 'c');
    expect(ownedSeats(removed, 'a')).toContain(3);
    const refilled = admit(removed, 'a', 'replacement');
    const merged = mergeRosters(refilled, offline);
    expect(merged).toEqual(mergeRosters(offline, refilled));
    expect(merged.members.map((item) => item.replicaId)).toEqual(['a', 'b', 'offline', 'replacement']);
    expect(mergeRosters(merged, shared)).toEqual(merged);
  });

  it('unsealed founder capacity cannot be reassigned; sealed removal releases founder seat too', () => {
    const shared = admit(genesis(), 'a', 'c');
    const pending = requestRetirement(shared, 'a', 'b');
    expect(ownedSeats(pending, 'a')).toEqual([4, 5]);
    expect(ownedSeats(pending, 'b')).toEqual([]);
    const removed = sealedRemoval(pending, 'a', 'b');
    expect(ownedSeats(removed, 'a')).toEqual([2, 4, 5, 6, 7, 8]);
  });
  it('sealed removal frees an occupied seat without restoring a stale member', () => {
    let full = genesis();
    for (const name of ['c', 'd', 'e']) full = admit(full, 'a', name);
    for (const name of ['f', 'g', 'h']) full = admit(full, 'b', name);
    const removed = sealedRemoval(full, 'a', 'c');
    expect(removed.members).toHaveLength(7);
    expect(ownedSeats(removed, 'a')).toHaveLength(1);
    const replacement = admit(removed, 'a', 'i');
    expect(replacement.members).toHaveLength(8);
    expect(mergeRosters(replacement, full)).toEqual(replacement);
    expect(replacement.members.map((item) => item.replicaId)).not.toContain('c');
    expect(ownedSeats(replacement, 'a')).toEqual([]);
  });

  it('repeated sealed join/remove stays admissible and bounded beyond every history cap', () => {
    let roster = genesis();
    expect(() => {
      for (let index = 0; index < 80; index++) {
        const before = roster, name = `churn-${index}`;
        expect(ownedSeats(roster, 'a').length).toBeGreaterThan(0);
        roster = admit(roster, 'a', name);
        expect(roster.members).toHaveLength(3);
        roster = sealedRemoval(roster, 'a', name);
        expect(roster.members.map((item) => item.replicaId)).toEqual(['a', 'b']);
        expect(mergeRosters(roster, before)).toEqual(roster);
        expect(roster.seats.every((seat) => seat.events.length <= 16)).toBe(true);
        expect(roster.retirements.length).toBeLessThanOrEqual(64);
        expect(roster.removals.length).toBeLessThanOrEqual(64);
        expect(roster.closures.length).toBeLessThanOrEqual(8);
        expect(Buffer.byteLength(JSON.stringify(roster))).toBeLessThanOrEqual(256 * 1024);
        expect(parseRoster(roster)).toEqual(roster);
      }
      for (const name of ['c', 'd', 'e']) roster = admit(roster, 'a', name);
      for (const name of ['f', 'g', 'h']) roster = admit(roster, 'b', name);
      expect(roster.members).toHaveLength(8);
      expect(ownedSeats(roster, 'a')).toEqual([]);
      expect(ownedSeats(roster, 'b')).toEqual([]);
    }).not.toThrow();
  });

  it('sealed founder removal reclaims its unspent seats for a surviving member', () => {
    const shared = admit(genesis(), 'a', 'c');
    let roster = sealedRemoval(shared, 'a', 'b');
    expect(ownedSeats(roster, 'b')).toEqual([]);
    expect(() => {
      for (const name of ['d', 'e', 'f', 'g', 'h', 'i']) {
        expect(ownedSeats(roster, 'a').length).toBeGreaterThan(0);
        roster = admit(roster, 'a', name);
      }
    }).not.toThrow();
    expect(roster.members).toHaveLength(8);
    expect(mergeRosters(roster, shared)).toEqual(roster);
  });

  it('offline sponsor frontier preserves committed admission; closure rejects later sponsor events, not descendants', () => {
    const shared = admit(genesis(), 'a', 'c');
    const offline = admit(shared, 'b', 'd');
    const pending = requestRetirement(shared, 'a', 'b');
    expect(isRetiring(pending, 'b')).toBe(true); expect(pending.members).toHaveLength(3);
    expect(() => removeMember(pending, 'a', 'b')).toThrow(/closure/);
    const sealed = closeRetirement(mergeRosters(offline, pending), 'b');
    expect(sealed.members).toHaveLength(4); expect(closeRetirement(sealed, 'b')).toEqual(sealed);
    const removed = removeMember(mergeRosters(pending, sealed), 'a', 'b');
    expect(removed.members.map((item) => item.replicaId)).toEqual(['a', 'c', 'd']);
    expect(() => mergeRosters(removed, admit(offline, 'b', 'e'))).toThrow(/closed frontier/);
    const delegated = transferSeat(offline, 'b', 'd', 'delegated-before-seal');
    const sealWithDelegation = closeRetirement(mergeRosters(delegated, pending), 'b');
    const final = removeMember(sealWithDelegation, 'a', 'b');
    const descendant = appendSeat(final, { kind: 'admit', seat: 7, requestId: 'descendant', ownerReplicaId: 'd', member: member('e', 'd') });
    expect(descendant.members.map((item) => item.replicaId)).toContain('e');
  });

  it('closure target, admission, heads, hash and immutable seal conflicts fail closed', () => {
    const shared = admit(genesis(), 'a', 'c'), pending = requestRetirement(shared, 'a', 'b');
    const sealed = closeRetirement(pending, 'b');
    for (const change of [{ admission: '0'.repeat(64) }, { replicaId: 'c' }, { heads: Array(8).fill('0'.repeat(64)) }]) {
      const altered = structuredClone(sealed), closure = altered.closures[0]!;
      Object.assign(closure, change); const { hash: _hash, ...body } = closure; closure.hash = eventHash(altered, body);
      expect(() => finalizeRoster(altered)).toThrow(/closure|frontier/);
    }
    const other = closeRetirement(mergeRosters(admit(shared, 'b', 'd'), pending), 'b');
    expect(() => mergeRosters(sealed, other)).toThrow(/conflicting.*closure/);
    expect(() => closeRetirement(shared, 'b')).toThrow(/retirement/);
  });

  it('closure must capture own admission and every referenced causal dependency', () => {
    const shared = transferSeat(admit(genesis(), 'a', 'c'), 'a', 'c', 'delegate-c');
    for (const target of ['b', 'c']) {
      const sealed = closeRetirement(requestRetirement(shared, 'a', target), target);
      const altered = structuredClone(sealed), closure = altered.closures[0]!;
      closure.heads[2] = closure.heads[0]!;
      if (target === 'c') closure.heads[3] = closure.heads[0]!;
      const { hash: _hash, ...body } = closure; closure.hash = eventHash(altered, body);
      expect(() => finalizeRoster(altered)).toThrow(target === 'b' ? /causal dependency/ : /target admission/);
    }
  });

  it('retirement request identities, keys, hashes and duplicates are immutable', () => {
    const pending = requestRetirement(admit(genesis(), 'a', 'c'), 'a', 'b');
    expect(requestRetirement(pending, 'a', 'b')).toEqual(pending);
    for (const change of [{ requestId: 'changed' }, { hash: '0'.repeat(64) }, { actorAdmission: '0'.repeat(64) },
      { admission: '0'.repeat(64) }, { replicaId: 'missing' }]) {
      const altered = structuredClone(pending); Object.assign(altered.retirements[0]!, change);
      expect(() => finalizeRoster(altered)).toThrow(/retirement request/);
    }
    expect(() => finalizeRoster({ ...pending, retirements: [...pending.retirements, pending.retirements[0]!] })).toThrow(/retirement request/);
  });
  it('splits vacancies 3/3 and converges independent admissions in both merge orders', () => {
    const root = genesis();
    expect(ownedSeats(root, 'a')).toEqual([3, 4, 5]); expect(ownedSeats(root, 'b')).toEqual([6, 7, 8]);
    const left = admit(admit(root, 'a', 'c'), 'a', 'd'), right = admit(root, 'b', 'e');
    expect(rosterCovers(left, right)).toBe(false); expect(rosterCovers(right, left)).toBe(false);
    const merged = mergeRosters(left, right);
    expect(merged).toEqual(mergeRosters(right, left)); expect(merged.members).toHaveLength(5);
    expect(merged.rosterEpoch).toBe(4); expect(rosterCovers(merged, left)).toBe(true); expect(rosterCovers(merged, right)).toBe(true);
    expect(mergeRosters(merged, root)).toEqual(merged);
  });

  it('new member receives dependency-referenced capacity and sponsors fourth without founders', () => {
    const third = admit(genesis(), 'b', 'c');
    const delegated = transferSeat(third, 'b', 'c', 'delegate');
    expect(delegated.seats[6]!.events[0]).toMatchObject({ kind: 'transfer', recipientAdmission: admissionReference(third, 'c') });
    expect(admit(delegated, 'c', 'd').members).toHaveLength(4);
    expect(() => transferSeat(genesis(), 'b', 'missing', 'transfer')).toThrow(/current member/);
    expect(() => transferSeat(genesis(), 'missing', 'a', 'transfer')).toThrow(/reserved capacity/);
  });

  it('transfer skips a byte-exhausted owned seat and fails only when all proposed events exceed the cap', () => {
    const a = 'a'.repeat(128), b = 'b'.repeat(128);
    let roster = createRoster('db', 'group', [
      { replicaId: a, machineId: 'app-a', joinedAt: 1, sponsorReplicaId: null },
      { replicaId: b, machineId: 'app-b', joinedAt: 1, sponsorReplicaId: a }
    ], 'join-b', a);
    for (let index = 0; index < 12; index++) roster = transferSeat(roster, index % 2 ? b : a, index % 2 ? a : b,
      `capacity-${String(index).padStart(64, '0')}`);
    const before = roster.seats[2]!.events;
    expect(Buffer.byteLength(JSON.stringify(before))).toBeGreaterThan(8800);
    const transferred = transferSeat(roster, a, b, 'capacity-next');
    expect(transferred.seats[2]!.events).toEqual(before);
    expect(transferred.seats[3]!.events[0]).toMatchObject({ kind: 'transfer', recipientReplicaId: b });
    for (const seat of [4, 5]) for (let index = 0; index < 12; index++) roster = appendSeat(roster, {
      kind: 'transfer', seat, requestId: `capacity-${String(index).padStart(64, '0')}`, ownerReplicaId: index % 2 ? b : a,
      recipientReplicaId: index % 2 ? a : b, recipientAdmission: admissionReference(roster, index % 2 ? a : b)
    });
    expect(() => transferSeat(roster, a, b, 'capacity-overflow')).toThrow(/reserved capacity/);
    expect(roster.seats[2]!.events).toEqual(before);
  });

  it('rejects forks, forged hash, parent, owner, missing dependency and independent projections', () => {
    const root = genesis(), third = admit(root, 'a', 'c');
    expect(() => mergeRosters(third, admit(root, 'a', 'd'))).toThrow(/forked/);
    for (const change of [{ hash: '0'.repeat(64) }, { parent: '0'.repeat(64) }, { ownerReplicaId: 'b' }, { ownerAdmission: '0'.repeat(64) }]) {
      const copy = structuredClone(third), event = copy.seats[2]!.events[0]!;
      Object.assign(event, change);
      if (!('hash' in change)) { const { hash: _hash, ...body } = event; event.hash = eventHash(copy, body); }
      expect(() => finalizeRoster(copy)).toThrow();
    }
    expect(() => parseRoster({ ...root, members: [member('forged')] })).toThrow(/projection/);
    expect(() => parseRoster({ ...root, digest: '0'.repeat(64) })).toThrow(/digest/);
    expect(() => parseRoster({ ...root, rosterEpoch: 99 })).toThrow(/epoch/);
    expect(() => parseRoster({ ...root, groupId: 'elsewhere' })).toThrow(/digest/);
    const missing = structuredClone(transferSeat(third, 'b', 'c', 'delegate'));
    missing.seats[2]!.events = [];
    expect(() => finalizeRoster(missing)).toThrow(/dependency/);
    expect(() => parseRoster({ repoId: 'db', groupId: 'old', members: root.members, rosterEpoch: 1 })).toThrow();
  });

  it('duplicate machine or replica rejects union without choosing a losing committed admission', () => {
    const root = genesis(), left = admit(root, 'a', 'c'), right = admit(root, 'b', 'c');
    expect(() => mergeRosters(left, right)).toThrow(/duplicate|request/);
    const changed = structuredClone(right), event = changed.seats[5]!.events[0]!;
    if (event.kind === 'admit') event.member.replicaId = 'other';
    event.requestId = 'different';
    const { hash: _hash, ...body } = event; event.hash = eventHash(changed, body);
    expect(() => mergeRosters(left, parseRoster(finalizeRoster(changed)))).toThrow(/duplicate/);
    expect(left.members).toHaveLength(3);
  });

  it('removal is irreversible under concurrent admissions; owner vacancies never reclaimed', () => {
    const root = genesis(), third = admit(root, 'b', 'c'), concurrent = admit(third, 'b', 'd');
    const removed = sealedRemoval(concurrent, 'c', 'b'), merged = mergeRosters(removed, third);
    expect(merged.members.map((item) => item.replicaId)).not.toContain('b');
    expect(ownedSeats(merged, 'b')).toEqual([]);
    expect(mergeRosters(merged, third)).toEqual(merged);
    expect(() => parseRoster({ ...removed, removals: [{ ...removed.removals[0]!, hash: '0'.repeat(64) }] })).toThrow(/removal/);
  });

  it('bounds complete history by event count and bytes, validates seat numbering and genesis', () => {
    let roster = genesis();
    for (const seat of [3, 4, 5, 6, 7, 8]) for (let index = 0; index < 16; index++) {
      const initial = seat <= 5 ? 'a' : 'b', owner = index % 2 ? (initial === 'a' ? 'b' : 'a') : initial;
      roster = appendSeat(roster, { kind: 'transfer', seat, requestId: `t-${seat}-${index}`, ownerReplicaId: owner,
        recipientReplicaId: owner === 'a' ? 'b' : 'a', recipientAdmission: admissionReference(roster, owner === 'a' ? 'b' : 'a') });
    }
    expect(roster.rosterEpoch).toBe(97);
    expect(() => transferSeat(roster, 'a', 'b', 'overflow')).toThrow(/capacity/);
    expect(() => appendSeat(roster, { kind: 'transfer', seat: 3, requestId: 'overflow', ownerReplicaId: 'a',
      recipientReplicaId: 'b', recipientAdmission: admissionReference(roster, 'b') })).toThrow(/seat.*limit/);
    expect(sealedRemoval(roster, 'a', 'b').members).toHaveLength(1);
    expect(() => parseRoster({ ...genesis(), padding: 'x'.repeat(256 * 1024) })).toThrow(/256KiB/);
    const wrong = genesis(); wrong.seats[0]!.seat = 2;
    expect(() => finalizeRoster(wrong)).toThrow(/seat numbering/);
    const founders = genesis(); founders.genesis.founders.reverse();
    expect(() => finalizeRoster(founders)).toThrow(/genesis/);
    const twin = genesis(); twin.genesis.founders[1]!.replicaId = twin.genesis.founders[0]!.replicaId;
    expect(() => finalizeRoster(twin)).toThrow(PeerProtocolError);
    expect(() => finalizeRoster(twin)).toThrow(/duplicate founder/);
  });

  it('disjoint saturated seat histories merge in either order; removal retries are canonical and separate', () => {
    const root = genesis();
    const saturate = (seats: number[]) => {
      let roster = root;
      for (const seat of seats) for (let index = 0; index < 16; index++) {
        const initial = seat <= 5 ? 'a' : 'b', owner = index % 2 ? (initial === 'a' ? 'b' : 'a') : initial;
        roster = appendSeat(roster, { kind: 'transfer', seat, requestId: `t-${seat}-${index}`, ownerReplicaId: owner,
          recipientReplicaId: owner === 'a' ? 'b' : 'a', recipientAdmission: admissionReference(roster, owner === 'a' ? 'b' : 'a') });
      }
      return roster;
    };
    const left = saturate([3, 4, 5]), right = saturate([6, 7, 8]);
    const merged = mergeRosters(left, right);
    expect(merged).toEqual(mergeRosters(right, left)); expect(merged.rosterEpoch).toBe(97);
    const over = structuredClone(left); over.seats[2]!.events.push(over.seats[2]!.events[0]!);
    expect(() => parseRoster(over)).toThrow();
    const sealed = closeRetirement(requestRetirement(merged, 'a', 'b'), 'b');
    const removed = removeMember(sealed, 'a', 'b');
    expect(removeMember(sealed, 'a', 'b')).toEqual(removed);
    expect(removeMember(removed, 'a', 'b')).toEqual(removed);
    expect(() => removeMember(sealed, 'b', 'b')).toThrow(/retirement request/);
    const otherActor = removeMember(requestRetirement(sealed, 'b', 'b'), 'b', 'b');
    expect(mergeRosters(removed, otherActor).removals).toHaveLength(2);
    const equivocation = structuredClone(removed), event = equivocation.removals[0]!;
    event.requestId = 'random-request'; const { hash: _hash, ...body } = event; event.hash = eventHash(equivocation, body);
    expect(() => finalizeRoster(equivocation)).toThrow(/canonical removal/);
  });

  it('maximum ID fields have merge-closed byte budgets and all 64 author-target tombstones fit', () => {
    const large = (index: number, sponsor: string | null): GroupMember => ({ replicaId: `r${index}${'r'.repeat(126)}`,
      machineId: `m${index}${'m'.repeat(126)}`, joinedAt: Number.MAX_SAFE_INTEGER, sponsorReplicaId: sponsor });
    const founders = [large(0, null), large(1, large(0, null).replicaId)];
    const root = createRoster('d'.repeat(128), 'g'.repeat(128), founders, 'j'.repeat(128), founders[0]!.replicaId);
    const branches = [0, 1].map((founder) => {
      let roster = root;
      for (const seat of founder ? [6, 7, 8] : [3, 4, 5]) {
        const owner = founders[founder]!.replicaId, recipient = founders[1 - founder]!.replicaId;
        let lastEven = roster;
        for (let index = 0; index < 16; index++) {
          try {
            roster = appendSeat(roster, { kind: 'transfer', seat, requestId: `${seat}${index}${'t'.repeat(125)}`.slice(0, 128),
              ownerReplicaId: index % 2 ? recipient : owner, recipientReplicaId: index % 2 ? owner : recipient,
              recipientAdmission: admissionReference(root, index % 2 ? owner : recipient) });
            if (index === 7) lastEven = roster;
          } catch (error) { expect((error as Error).message).toMatch(/seat history limit/); break; }
        }
        // Admission is committed against a complete prefix, leaving byte room for the occupied terminal event.
        roster = appendSeat(lastEven, { kind: 'admit', seat, requestId: `${seat}${'j'.repeat(127)}`, ownerReplicaId: owner,
          member: large(seat, owner) });
      }
      return roster;
    });
    let merged = mergeRosters(branches[0]!, branches[1]!);
    expect(merged.members).toHaveLength(8); expect(merged).toEqual(mergeRosters(branches[1]!, branches[0]!));
    const identities = merged.members.map((item) => item.replicaId);
    for (const actor of identities) for (const target of identities) merged = requestRetirement(merged, actor, target);
    for (const target of identities) merged = closeRetirement(merged, target);
    for (const actor of identities) for (const target of identities) merged = removeMember(merged, actor, target);
    expect(merged.retirements).toHaveLength(64); expect(merged.closures).toHaveLength(8);
    expect(merged.removals).toHaveLength(64);
    expect(Buffer.byteLength(JSON.stringify(merged))).toBeLessThan(256 * 1024);
    expect(parseRoster(merged)).toEqual(merged);
    expect(() => parseRoster({ ...merged, removals: [...merged.removals, merged.removals[0]!] })).toThrow();
  });
});
