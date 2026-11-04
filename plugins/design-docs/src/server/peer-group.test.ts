import { describe, expect, it } from 'vitest';
import { capacityRequestId, DesignDocPeerGroup, parseRoster, rosterCovers, type Admission } from './peer-group.js';
import { admissionReference, appendSeat, ownedSeats, mergeRosters, closeRetirement, removeMember, requestRetirement } from './peer-slots.js';
import { DesignDocStore } from './store.js';
import { createTestDatabase } from './test-db.js';

function fixture(name: string, now = () => 100) {
  const db = createTestDatabase(); new DesignDocStore(db);
  const group = new DesignDocPeerGroup(db, now);
  return { db, group, replica: group.sync.localRepository()!.replicaId, peer: `app-${name}` };
}
type App = ReturnType<typeof fixture>;
function enabled(a: App, b: App) {
  a.group.enable(a.peer, b.peer, 'database', b.replica);
  b.group.enable(b.peer, a.peer, 'database', a.replica);
}
function request(a: App, b: App, delegateCount = 1): Admission {
  const consent = b.group.consent();
  const input = { requestId: consent?.requestId ?? `join-${b.peer}`, repoId: 'database', groupId: a.group.roster()?.groupId ?? null,
    sponsorReplicaId: a.replica, delegateCount, member: { replicaId: b.replica, machineId: b.peer, joinedAt: 100, sponsorReplicaId: a.replica } };
  return consent ? b.group.freezeJoin(input) : input;
}
function found(a: App, b: App) {
  enabled(a, b); const receipt = a.group.admit(request(a, b), b.peer); b.group.apply(receipt.roster, a.peer);
  return receipt;
}
function join(a: App, b: App, delegateCount = 1) {
  enabled(a, b); const input = request(a, b, delegateCount), receipt = a.group.admit(input, b.peer);
  b.group.apply(receipt.roster, a.peer); return { input, receipt };
}
function retire(a: App, b: App) {
  const pending = a.group.remove(b.replica), sealed = b.group.retire(pending.roster, a.peer);
  a.group.apply(sealed, b.peer);
  const done = a.group.remove(b.replica);
  b.group.apply(done.roster, a.peer);
  return done;
}

describe('transactional reserved-slot admission', () => {
  it('completed removed-member receipts cannot permanently exhaust the bounded control table', () => {
    const a = fixture('a'), b = fixture('b'), c = fixture('c'); found(a, b);
    const { input, receipt } = join(a, c, 0); retire(a, c);
    for (const job of a.group.jobs()) a.group.finishJob(job.id);
    const insert = a.db.prepare('INSERT OR REPLACE INTO sync_group_admissions (request_id, request_json, receipt_json) VALUES (?, ?, ?)');
    for (let index = 0; index < 1024; index++) insert.run(`old-${index}`, JSON.stringify(input), JSON.stringify(receipt));
    const d = fixture('d');
    expect(() => join(a, d, 0)).not.toThrow();
    expect((a.db.prepare('SELECT COUNT(*) AS n FROM sync_group_admissions').get() as { n: number }).n).toBeLessThanOrEqual(1024);
  });
  it('80 product join/remove cycles retain admission capacity across restart and bounded governance', () => {
    const a = fixture('a'), b = fixture('b'); found(a, b);
    for (let index = 0; index < 80; index++) {
      const c = fixture(`churn-${index}`);
      join(a, c, 0); retire(a, c);
      for (const app of [a, b, c]) for (const job of app.group.jobs()) app.group.finishJob(job.id);
      expect(new DesignDocPeerGroup(a.db).hasCapacity()).toBe(true);
      const roster = a.group.roster()!;
      expect(roster.members).toHaveLength(2);
      expect(roster.seats.every((seat) => seat.events.length <= 16)).toBe(true);
      expect(roster.closures.length).toBeLessThanOrEqual(8);
      expect(roster.removals.length).toBeLessThanOrEqual(64);
    }
  }, 60_000);
  it('lost admission ACK survives sponsor self-leave; exact immutable receipt is read-only and final initial roster excludes sponsor', () => {
    const a = fixture('a'), b = fixture('b'), c = fixture('c'); found(a, b);
    enabled(b, c); const input = request(b, c), receipt = b.group.admit(input, c.peer);
    const final = b.group.remove(b.replica).roster, jobs = b.group.jobs();
    expect(new DesignDocPeerGroup(b.db).admit(input, c.peer)).toEqual(receipt);
    expect(b.group.jobs()).toEqual(jobs); expect(b.group.sync.localRepository()!.groupId).toBeNull();
    expect(() => b.group.admit({ ...input, delegateCount: 0 }, c.peer)).toThrow(/different payload/);
    expect(() => b.group.admit(input, a.peer)).toThrow(/identity/);
    const noSeal = { ...final, closures: [], removals: [] };
    expect(() => c.group.apply(noSeal, b.peer)).toThrow(); expect(c.group.roster()).toBeNull();
    c.group.apply(final, b.peer);
    expect(c.group.roster()).toEqual(final); expect(c.group.roster()!.members.some((member) => member.replicaId === b.replica)).toBe(false);
  });

  it.each([false, true])('first install rejects post-frontier history from a sealed sponsor (removed=%s)', (removed) => {
    const a = fixture('a'), b = fixture('b'), c = fixture('c'); found(a, b);
    enabled(b, c); const input = request(b, c), receipt = b.group.admit(input, c.peer);
    let sealed = closeRetirement(requestRetirement(receipt.roster, b.replica, b.replica), b.replica);
    if (removed) sealed = removeMember(sealed, b.replica, b.replica);
    const forged = appendSeat(sealed, { kind: 'admit', seat: ownedSeats(sealed, a.replica)[0]!, requestId: 'post-seal',
      ownerReplicaId: a.replica, member: { replicaId: 'fake-d', machineId: 'app-fake-d', joinedAt: 100, sponsorReplicaId: a.replica } });
    const consent = c.group.consent(), jobs = c.group.jobs();
    expect(() => c.group.apply(forged, b.peer)).toThrow(/consent|frontier/);
    expect(c.group.roster()).toBeNull(); expect(c.group.consent()).toEqual(consent); expect(c.group.jobs()).toEqual(jobs);
    c.group.apply(sealed, b.peer);
    expect(c.group.roster()!.members.map((member) => member.machineId).sort()).toEqual([a.peer, c.peer]);
    expect(c.group.hasCapacity()).toBe(true);
  });

  it('terminal completion jobs preserve bounded history and recipients across later admissions and restart', () => {
    const a = fixture('a'), b = fixture('b'), c = fixture('c'), d = fixture('d'), e = fixture('e'); found(a, b);
    const shared = join(a, c, 0).receipt.roster; b.group.apply(shared, a.peer);
    const final = retire(a, b).roster; c.group.apply(final, a.peer);
    const completion = b.group.jobs().filter((job) => job.kind === 'roster');
    expect(completion.some((job) => job.peerId === c.peer && job.state !== 'done')).toBe(true);
    const later = join(a, d, 0).receipt.roster;
    b.group.apply(later, a.peer);
    expect(b.group.jobs().filter((job) => job.kind === 'roster')).toEqual(completion);
    expect(b.group.jobs().some((job) => job.peerId === d.peer)).toBe(false);
    const restarted = new DesignDocPeerGroup(b.db);
    const newer = join(a, e, 0).receipt.roster; restarted.apply(newer, a.peer);
    expect(restarted.jobs().filter((job) => job.kind === 'roster')).toEqual(completion);
    expect(restarted.sync.localRepository()!.groupId).toBeNull();
    for (const job of completion) restarted.acknowledgeRoster(final, job.peerId);
    expect(restarted.jobs(true).some((job) => job.kind === 'roster')).toBe(false);
    expect(restarted.removalDeliveryPending(c.peer)).toBe(false);
  });

  it('sealed terminal jobs advance known tombstones without importing later admissions or retirement requests', () => {
    const a = fixture('a'), b = fixture('b'), c = fixture('c'), d = fixture('d'); found(a, b);
    const shared = join(a, c, 0).receipt.roster; b.group.apply(shared, a.peer);
    const pending = a.group.remove(b.replica).roster, sealed = b.group.retire(pending, a.peer);
    a.group.apply(sealed, b.peer);
    const later = join(a, d, 0).receipt.roster;
    b.group.apply(later, a.peer);
    const terminalJobs = b.group.jobs().filter((job) => job.kind === 'roster');
    expect(terminalJobs.map((job) => job.peerId).sort()).toEqual([a.peer, c.peer]);
    for (const job of terminalJobs) {
      const payload = parseRoster(job.payload);
      expect(payload.seats).toEqual(sealed.seats);
      expect(payload.retirements).toEqual(sealed.retirements);
      expect(payload.removals.some((event) => event.replicaId === b.replica)).toBe(true);
      b.group.acknowledgeRoster(payload, job.peerId);
    }
    const after = b.group.jobs();
    const retirement = a.group.remove(d.replica).roster;
    b.group.apply(retirement, a.peer);
    expect(b.group.jobs()).toEqual(after);
    expect(b.group.sync.localRepository()!.groupId).toBeNull();
  });

  it('sealed sponsor delegation remains usable through product admission path', () => {
    const a = fixture('a'), b = fixture('b'), c = fixture('c'), d = fixture('d'); found(a, b);
    const third = join(b, c).receipt; a.group.apply(third.roster, b.peer);
    const pending = a.group.remove(b.replica); c.group.apply(pending.roster, a.peer);
    expect(c.group.hasCapacity()).toBe(false);
    const sealed = b.group.retire(pending.roster, a.peer); a.group.apply(sealed, b.peer); c.group.apply(a.group.roster(), a.peer);
    expect(c.group.hasCapacity()).toBe(true);
    expect(join(c, d, 0).receipt.roster.members.map((member) => member.machineId)).toContain(d.peer);
    expect(ownedSeats(c.group.roster()!, b.replica)).toEqual([]);
  });

  it('new admissions do not recreate completed delivery jobs to departed peers', () => {
    const a = fixture('a'), b = fixture('b'), c = fixture('c'), d = fixture('d'); found(a, b);
    const third = join(b, c).receipt; a.group.apply(third.roster, b.peer);
    const final = retire(a, b).roster; c.group.apply(final, a.peer);
    for (const job of c.group.jobs()) c.group.finishJob(job.id);
    join(c, d, 0);
    expect(c.group.jobs().some((job) => job.kind === 'roster' && job.peerId === b.peer && job.state !== 'done')).toBe(false);
  });

  it('delivery proof acknowledges only exact peer jobs covered by authenticated known history', () => {
    const a = fixture('a'), b = fixture('b'), c = fixture('c'); const root = found(a, b).roster;
    const third = join(a, c).receipt.roster, before = a.group.jobs();
    expect(() => a.group.acknowledgeRoster(third, 'unknown')).toThrow(/proof/); expect(a.group.jobs()).toEqual(before);
    a.group.acknowledgeRoster(root, b.peer);
    expect(a.group.removalDeliveryPending(b.peer)).toBe(true);
    a.group.acknowledgeRoster(third, b.peer);
    expect(a.group.removalDeliveryPending(b.peer)).toBe(false); expect(a.group.removalDeliveryPending(c.peer)).toBe(true);
    const d = fixture('d'); const unseen = join(c, d, 0).receipt.roster;
    expect(() => a.group.acknowledgeRoster(unseen, c.peer)).toThrow(/proof/);
  });

  it('cyclic authorized retirements complete with original actors even after all actors retire', () => {
    const a = fixture('a'), b = fixture('b'), c = fixture('c'); found(a, b);
    const shared = join(a, c, 0).receipt.roster; b.group.apply(shared, a.peer);
    const requests = [a.group.remove(b.replica).roster, b.group.remove(c.replica).roster, c.group.remove(a.replica).roster];
    const barrier = requests.reduce(mergeRosters);
    const seals = [a, b, c].map((target, index) => target.group.retire(barrier, [c, a, b][index]!.peer));
    const witnessed = seals.reduce(mergeRosters);
    for (const [target, sender] of [[a, b], [b, c], [c, a]] as const) target.group.apply(witnessed, sender.peer);
    const final = a.group.roster()!;
    expect(final.members).toEqual([]); expect(final.removals).toHaveLength(3);
    expect(final.removals.map((event) => [event.actorReplicaId, event.replicaId]).sort()).toEqual(
      [[a.replica, b.replica], [b.replica, c.replica], [c.replica, a.replica]].sort());
    for (const target of [a, b, c]) expect(target.group.sync.localRepository()!.groupId).toBeNull();
    const unauthorized = closeRetirement(requestRetirement(shared, a.replica, b.replica), b.replica);
    expect(() => removeMember(unauthorized, c.replica, b.replica)).toThrow(/retirement request/);
    const fresh = requestRetirement(final, a.replica, c.replica);
    expect(() => a.group.apply(fresh, b.peer)).toThrow(/sender/);
  });
  it('retirement is durable pending until target seals offline admissions; never deletes committed descendants', () => {
    const a = fixture('a'), b = fixture('b'), c = fixture('c'), d = fixture('d'); found(a, b);
    const third = join(a, c, 0).receipt; b.group.apply(third.roster, a.peer);
    join(b, d, 0);
    const pending = a.group.remove(b.replica);
    expect(pending.stage).toBe('retiring'); expect(pending.roster.members).toHaveLength(3);
    expect(a.group.remove(b.replica)).toEqual(pending);
    expect(new DesignDocPeerGroup(a.db).jobs().some((job) => job.kind === 'retire')).toBe(true);
    const sealed = b.group.retire(pending.roster, a.peer);
    expect(sealed.closures).toHaveLength(1); expect(sealed.members).toHaveLength(4);
    expect(new DesignDocPeerGroup(b.db).retire(pending.roster, a.peer).closures).toEqual(sealed.closures);
    const newcomer = fixture('e'); enabled(b, newcomer);
    expect(() => b.group.admit(request(b, newcomer), newcomer.peer)).toThrow(/retiring|removed/);
    a.group.apply(sealed, b.peer); const done = a.group.remove(b.replica);
    expect(done.stage).toBe('removed'); expect(done.roster.members.map((item) => item.machineId)).toContain(d.peer);
    c.group.apply(done.roster, a.peer); expect(c.group.roster()).toEqual(done.roster);
    expect(() => a.group.apply(sealed, d.peer)).not.toThrow();
  });

  it('seal transaction fault rolls back barrier and jobs; restart retries immutable seal without issuer authority', () => {
    const a = fixture('a'), b = fixture('b'), c = fixture('c'); found(a, b);
    const third = join(a, c, 0).receipt; b.group.apply(third.roster, a.peer);
    const pending = a.group.remove(b.replica), before = b.group.roster(), jobs = b.group.jobs();
    b.db.runScript("CREATE TRIGGER seal_fault BEFORE INSERT ON sync_group_jobs WHEN NEW.kind = 'roster' BEGIN SELECT RAISE(ABORT, 'seal disk full'); END;");
    expect(() => b.group.retire(pending.roster, a.peer)).toThrow('seal disk full');
    expect(b.group.roster()).toEqual(before); expect(b.group.jobs()).toEqual(jobs);
    b.db.runScript('DROP TRIGGER seal_fault;');
    const sealed = b.group.retire(pending.roster, a.peer), restarted = new DesignDocPeerGroup(b.db);
    expect(restarted.retire(pending.roster, a.peer).closures).toEqual(sealed.closures);
    const donorReplicaId = b.replica, admissionRequestId = 'new-capacity';
    expect(() => restarted.transfer({ requestId: capacityRequestId(admissionRequestId, donorReplicaId), admissionRequestId,
      repoId: 'database', groupId: sealed.groupId, donorReplicaId, recipientReplicaId: a.replica }, a.peer)).toThrow(/retiring|mismatch/);
    a.group.apply(sealed, b.peer);
    const after = a.group.roster(), later = appendSeat(after!, { kind: 'admit', seat: ownedSeats(after!, a.replica)[0]!, requestId: 'unchecked',
      ownerReplicaId: a.replica, member: { replicaId: 'unchecked-d', machineId: 'unchecked-d', joinedAt: 100, sponsorReplicaId: a.replica } });
    expect(() => a.group.apply(later, b.peer)).toThrow(/sender/); expect(a.group.roster()).toEqual(after);
  });

  it('lost seal ACK retry after final removal never restores local group or adds jobs', () => {
    const a = fixture('a'), b = fixture('b'), c = fixture('c'); found(a, b);
    b.group.apply(join(a, c, 0).receipt.roster, a.peer);
    const pending = a.group.remove(b.replica), sealed = b.group.retire(pending.roster, a.peer);
    a.group.apply(sealed, b.peer); b.group.apply(a.group.roster(), a.peer);
    expect(b.group.sync.localRepository()!.groupId).toBeNull();
    const final = b.group.roster(), jobs = b.group.jobs(), restarted = new DesignDocPeerGroup(b.db);
    expect(restarted.retire(pending.roster, a.peer)).toEqual(final);
    expect(restarted.sync.localRepository()!.groupId).toBeNull(); expect(restarted.jobs()).toEqual(jobs);
  });
  it('founder A asleep: B admits C, delegates atomically, then C sponsors D', () => {
    const a = fixture('a'), b = fixture('b'), c = fixture('c'), d = fixture('d'); found(a, b);
    const third = join(b, c).receipt;
    expect(a.group.roster()!.members).toHaveLength(2); expect(c.group.hasCapacity()).toBe(true);
    const fourth = join(c, d).receipt;
    b.group.apply(fourth.roster, c.peer); a.group.apply(b.group.roster(), b.peer); d.group.apply(b.group.roster(), c.peer);
    expect(a.group.roster()).toEqual(b.group.roster()); expect(d.group.roster()).toEqual(a.group.roster());
    expect(a.group.roster()!.members).toHaveLength(4); expect(rosterCovers(fourth.roster, third.roster)).toBe(true);
    expect(c.group.sync.members('database')).toHaveLength(4);
  });

  it('partitioned founders admit independently, merge both orders with unequal incomparable counts', () => {
    const a = fixture('a'), b = fixture('b'); found(a, b);
    join(a, fixture('c'), 0); join(a, fixture('d'), 0); join(b, fixture('e'), 0);
    const left = a.group.roster()!, right = b.group.roster()!;
    expect(left.rosterEpoch).toBe(3); expect(right.rosterEpoch).toBe(2); expect(rosterCovers(left, right)).toBe(false);
    a.group.apply(right, b.peer); b.group.apply(left, a.peer);
    expect(a.group.roster()).toEqual(b.group.roster()); expect(a.group.roster()!.members).toHaveLength(5);
    expect(a.group.roster()!.rosterEpoch).toBe(4);
    a.group.apply(right, b.peer); expect(a.group.roster()).toEqual(b.group.roster());
    const row = a.db.prepare('SELECT roster_json FROM sync_group_control').get() as { roster_json: string };
    expect(JSON.parse(row.roster_json).digest).toBe(a.group.roster()!.digest);
  });

  it('lost ACK and restart return immutable receipt without consuming another seat or adding jobs', () => {
    const a = fixture('a'), b = fixture('b'), c = fixture('c'); found(a, b);
    const { input, receipt } = join(b, c); const jobs = b.group.jobs();
    const restarted = new DesignDocPeerGroup(b.db);
    expect(restarted.admit(input, c.peer)).toEqual(receipt); expect(restarted.jobs()).toEqual(jobs);
    expect(() => restarted.admit({ ...input, delegateCount: 0 }, c.peer)).toThrow(/different payload/);
    expect(() => restarted.admit({ ...input, requestId: 'different' }, c.peer)).toThrow(/manual sponsor|already admitted/);
    expect(() => restarted.admit(input, 'unknown')).toThrow(/identity/);
  });

  it('owned capacity exhaustion waits; authenticated durable transfer unlocks join, ACK loss retries exact receipt', () => {
    const a = fixture('a'), b = fixture('b'); found(a, b);
    for (const name of ['c', 'd', 'e']) join(b, fixture(name), 0);
    const f = fixture('f'); enabled(b, f); const input = request(b, f);
    expect(() => b.group.admit(input, f.peer)).toThrow('waiting for reserved capacity');
    const transfer = { requestId: capacityRequestId(input.requestId, a.replica), admissionRequestId: input.requestId,
      repoId: 'database', groupId: a.group.roster()!.groupId, donorReplicaId: a.replica, recipientReplicaId: b.replica };
    const receipt = a.group.transfer(transfer, b.peer), jobs = a.group.jobs();
    expect(new DesignDocPeerGroup(a.db).transfer(transfer, b.peer)).toEqual(receipt); expect(a.group.jobs()).toEqual(jobs);
    expect(() => a.group.transfer({ ...transfer, repoId: 'other' }, b.peer)).toThrow(/mismatch/);
    expect(() => a.group.transfer({ ...transfer, requestId: 'random' }, b.peer)).toThrow(/mismatch/);
    expect(() => a.group.transfer(transfer, 'unknown')).toThrow(/mismatch/);
    const changed = { ...transfer, admissionRequestId: 'other', requestId: capacityRequestId('other', a.replica) };
    a.db.prepare('INSERT INTO sync_group_admissions (request_id, request_json, receipt_json) VALUES (?, ?, ?)')
      .run(changed.requestId, '{}', '{}');
    expect(() => a.group.transfer(changed, b.peer)).toThrow(/different payload/);
    b.group.apply(receipt.roster, a.peer);
    expect(b.group.admit(input, f.peer).roster.members).toHaveLength(6);
  });

  it('admission and default delegation skip byte-exhausted seat histories without changing committed receipts', () => {
    const a = fixture('a'), b = fixture('b'), c = fixture('c');
    for (const [app, replica] of [[a, 'a'.repeat(128)], [b, 'b'.repeat(128)]] as const) {
      app.db.prepare('UPDATE sync_repositories SET replica_id = ?').run(replica); app.replica = replica;
    }
    let roster = found(a, b).roster;
    for (const seat of [3, 4]) for (let index = 0; index < 12; index++) roster = appendSeat(roster, {
      kind: 'transfer', seat, requestId: `capacity-${String(index).padStart(64, '0')}`, ownerReplicaId: index % 2 ? b.replica : a.replica,
      recipientReplicaId: index % 2 ? a.replica : b.replica, recipientAdmission: admissionReference(roster, index % 2 ? a.replica : b.replica)
    });
    a.group.apply(roster, b.peer);
    enabled(a, c); const input = request(a, c), receipt = a.group.admit(input, c.peer);
    expect(receipt.roster.seats[2]!.events).toEqual(roster.seats[2]!.events);
    expect(receipt.roster.seats[3]!.events).toEqual(roster.seats[3]!.events);
    expect(receipt.roster.seats[4]!.events[0]).toMatchObject({ kind: 'admit', member: { replicaId: c.replica } });
    expect(new DesignDocPeerGroup(a.db).admit(input, c.peer)).toEqual(receipt);
    expect(receipt.roster.seats.flatMap((seat) => seat.events).some((event) => event.kind === 'transfer' && event.recipientReplicaId === c.replica)).toBe(false);
    const extra = fixture('extra'); enabled(a, extra); const overflow = request(a, extra, 0), jobs = a.group.jobs();
    expect(() => a.group.admit(overflow, extra.peer)).toThrow(/reserved capacity/);
    expect(a.group.roster()).toEqual(receipt.roster); expect(a.group.jobs()).toEqual(jobs);
    expect(a.db.prepare('SELECT request_id FROM sync_group_admissions WHERE request_id = ?').get(overflow.requestId)).toBeUndefined();

    const d = fixture('d'), e = fixture('e'), f = fixture('f');
    for (const [app, replica] of [[d, 'd'.repeat(128)], [e, 'e'.repeat(128)]] as const) {
      app.db.prepare('UPDATE sync_repositories SET replica_id = ?').run(replica); app.replica = replica;
    }
    let delegated = found(d, e).roster;
    for (let index = 0; index < 12; index++) delegated = appendSeat(delegated, {
      kind: 'transfer', seat: 3, requestId: `capacity-${String(index).padStart(64, '0')}`, ownerReplicaId: index % 2 ? e.replica : d.replica,
      recipientReplicaId: index % 2 ? d.replica : e.replica, recipientAdmission: admissionReference(delegated, index % 2 ? d.replica : e.replica)
    });
    d.group.apply(delegated, e.peer);
    const result = join(d, f).receipt.roster;
    expect(result.seats[2]!.events).toEqual(delegated.seats[2]!.events);
    expect(result.seats[3]!.events[0]).toMatchObject({ kind: 'admit', member: { replicaId: f.replica } });
    expect(result.seats[4]!.events[0]).toMatchObject({ kind: 'transfer', recipientReplicaId: f.replica });
    expect(f.group.hasCapacity()).toBe(true);
  });

  it('eight concurrent members reject ninth; sealed removal admits replacement', () => {
    const a = fixture('a'), b = fixture('b'); found(a, b);
    for (const name of ['c', 'd', 'e']) join(a, fixture(name), 0);
    for (const name of ['f', 'g', 'h']) join(b, fixture(name), 0);
    a.group.apply(b.group.roster(), b.peer); b.group.apply(a.group.roster(), a.peer);
    const ninth = fixture('i'); enabled(a, ninth); const input = request(a, ninth);
    expect(() => a.group.admit(input, ninth.peer)).toThrow('group full (8)');
    retire(a, b);
    expect(a.group.roster()!.members).toHaveLength(7);
    expect(() => a.group.admit(input, ninth.peer)).not.toThrow();
    expect(a.group.roster()!.members).toHaveLength(8);
    const tenth = fixture('j'); enabled(a, tenth);
    expect(() => a.group.admit(request(a, tenth), tenth.peer)).toThrow('group full (8)');
  });

  it('job insertion fault rolls back roster, receipt, delegated seats and sync epoch', () => {
    const a = fixture('a'), b = fixture('b'); enabled(a, b);
    a.db.runScript("CREATE TRIGGER fail_jobs BEFORE INSERT ON sync_group_jobs BEGIN SELECT RAISE(ABORT, 'disk full'); END;");
    expect(() => a.group.admit(request(a, b), b.peer)).toThrow('disk full');
    expect(a.group.roster()).toBeNull(); expect(a.group.sync.localRepository()!.rosterEpoch).toBe(0);
    expect(a.group.jobs()).toEqual([]); expect(a.db.prepare('SELECT COUNT(*) AS n FROM sync_group_admissions').get()).toEqual({ n: 0 });
    a.db.runScript('DROP TRIGGER fail_jobs;'); found(a, b);
    const c = fixture('c'); enabled(a, c); const before = a.group.roster();
    a.db.runScript("CREATE TRIGGER fail_jobs BEFORE INSERT ON sync_group_jobs BEGIN SELECT RAISE(ABORT, 'disk full'); END;");
    expect(() => a.group.admit(request(a, c), c.peer)).toThrow('disk full'); expect(a.group.roster()).toEqual(before);
    a.db.runScript('DROP TRIGGER fail_jobs;');
    const third = a.group.admit(request(a, c), c.peer);
    const beforeApply = b.group.roster(), priorJobs = b.group.jobs();
    b.db.runScript("CREATE TRIGGER fail_introduction BEFORE INSERT ON sync_group_jobs WHEN NEW.kind = 'introduce' BEGIN SELECT RAISE(ABORT, 'introduction disk full'); END;");
    expect(() => b.group.apply(third.roster, a.peer)).toThrow('introduction disk full');
    expect(b.group.roster()).toEqual(beforeApply); expect(b.group.jobs()).toEqual(priorJobs);
  });

  it('any current member removes or leaves with irreversible tombstone and permanent owner freeze', () => {
    const a = fixture('a'), b = fixture('b'), c = fixture('c'); const first = found(a, b);
    const { input, receipt: third } = join(b, c); a.group.apply(third.roster, b.peer);
    const removed = retire(c, b); a.group.apply(removed.roster, c.peer); b.group.apply(removed.roster, a.peer);
    expect(a.group.sync.members('database')).toHaveLength(2); expect(b.group.sync.localRepository()!.groupId).toBeNull();
    expect(ownedSeats(a.group.roster()!, b.replica)).toEqual([]);
    a.group.apply(first.roster, c.peer); expect(a.group.roster()).toEqual(removed.roster);
    const beforeAck = a.group.roster(); a.group.apply(third.roster, b.peer); expect(a.group.roster()).toEqual(beforeAck);
    expect(b.group.admit(input, c.peer)).toEqual(third);
    expect(() => a.group.remove(c.replica)).toThrow(/below 2/);
    expect(() => a.group.remove('missing')).toThrow(/not found/);
    const d = fixture('d'); const fourth = join(a, d, 0).receipt; c.group.apply(fourth.roster, a.peer);
    const left = c.group.remove(c.replica); expect(left.roster.members).toHaveLength(2);
    expect(c.group.sync.localRepository()!.groupId).toBeNull(); expect(c.group.jobs().some((job) => job.kind === 'local-revoke')).toBe(true);
  });

  it('a two-member group refuses removing the other member but lets this computer leave', () => {
    const a = fixture('a'), b = fixture('b'); found(a, b);
    expect(() => a.group.remove(b.replica)).toThrow(/below 2/);
    const left = a.group.remove(a.replica);
    expect(left.stage).toBe('removed'); expect(left.roster.members.map((member) => member.replicaId)).toEqual([b.replica]);
    expect(a.group.sync.localRepository()!.groupId).toBeNull();
  });

  it('rejects forks, forged owner/hash/projection, unknown sender and scope atomically', () => {
    const a = fixture('a'), b = fixture('b'), c = fixture('c'); found(a, b); const root = a.group.roster()!;
    const { receipt } = join(a, c, 0); const before = a.group.roster(), jobs = a.group.jobs();
    const fork = appendSeat(root, { kind: 'admit', seat: ownedSeats(root, a.replica)[0]!, requestId: 'fork', ownerReplicaId: a.replica,
      member: { replicaId: 'forged', machineId: 'forged', joinedAt: 100, sponsorReplicaId: a.replica } });
    for (const roster of [fork, { ...receipt.roster, digest: '0'.repeat(64) }, { ...root, members: [] }, { ...root, repoId: 'wrong' }]) {
      expect(() => a.group.apply(roster, b.peer)).toThrow(); expect(a.group.roster()).toEqual(before); expect(a.group.jobs()).toEqual(jobs);
    }
    expect(() => a.group.apply(receipt.roster, 'unknown')).toThrow(/sender/);
    expect(() => parseRoster({ ...root, unexpectedAuthority: a.replica })).toThrow();
    expect(() => a.group.enable(a.peer, b.peer, 'other-db', b.replica)).toThrow(/another group/);
    expect(() => a.group.enable('different', b.peer, 'database', b.replica)).toThrow(/local app identity/);
    expect(() => a.group.enable(a.peer, a.peer, 'database', b.replica)).toThrow(/local app/);
  });

  it('requires exact frozen local consent; never switch sponsors or cancel unknown join', () => {
    const a = fixture('a'), b = fixture('b'), c = fixture('c'); enabled(a, b);
    const input = request(a, b); expect(() => b.group.cancelSetup(a.peer)).toThrow(/outcome unknown/);
    expect(() => b.group.enable(b.peer, c.peer, 'database', c.replica)).toThrow(/another database setup/);
    expect(b.group.freezeJoin({ ...input, requestId: 'different' })).toEqual(input);
    const receipt = a.group.admit(input, b.peer);
    expect(() => c.group.apply(receipt.roster, a.peer)).toThrow(/database mismatch/);
    b.group.apply(receipt.roster, a.peer);
    const d = fixture('d'); enabled(b, d);
    const wrong = { ...request(b, d), requestId: 'not-consented' };
    const other = b.group.admit(wrong, d.peer);
    expect(() => d.group.apply(other.roster, b.peer)).toThrow(/consent/);
    const e = fixture('e'); e.group.enable(e.peer, a.peer, 'database', a.replica);
    expect(() => e.group.freezeJoin({ ...input, member: { ...input.member, replicaId: e.replica } })).toThrow(/consent mismatch/);
    e.group.cancelSetup(a.peer); expect(e.group.consent()).toBeNull();
  });

  it('coalesces roster jobs by causal coverage, not numeric epoch; backoff survives restart', () => {
    let now = 100; const a = fixture('a', () => now), b = fixture('b'); const root = found(a, b).roster;
    const job = a.group.jobs()[0]!; a.group.finishJob(job.id, 'offline'); expect(a.group.jobs(true)).toEqual([]);
    now += 30_000; expect(a.group.jobs(true)[0]).toMatchObject({ state: 'blocked', attempts: 1, error: 'offline' });
    a.group.finishJob(job.id); expect(a.group.jobs(true)).toEqual([]);
    const next = join(a, fixture('c'), 0).receipt.roster;
    a.group.queueRoster(root, b.peer);
    expect(a.group.jobs().filter((item) => item.peerId === b.peer && item.kind === 'roster')).toHaveLength(1);
    expect(a.group.jobs().find((item) => item.peerId === b.peer)!.payload).toEqual(next);
    const d = fixture('d'); enabled(a, d);
    a.db.runScript(`WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<1024)
      INSERT INTO sync_group_admissions SELECT 'old-'||x, '{}', '{}' FROM n;`);
    expect(() => a.group.admit(request(a, d), d.peer)).toThrow(/capacity/); expect(a.group.roster()).toEqual(next);
  });

  it('introduction backlog cannot block removal; stale jobs pruned and SQL faults still roll back everything', () => {
    const a = fixture('a'), b = fixture('b'), c = fixture('c'); found(a, b); join(a, c);
    const scope = a.group.roster()!.repoId;
    for (let epoch = 1; epoch <= 60; epoch++) {
      a.group.queueJob(a.peer, 'introduce', epoch, { peerId: b.peer, sponsorPeerId: c.peer, scope });
    }
    expect(a.group.jobs().filter((job) => job.kind === 'introduce')).toHaveLength(2);
    a.db.runScript(`WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<1024)
      INSERT INTO sync_group_jobs (id, peer_id, kind, roster_epoch, payload_json) SELECT 'obsolete-'||x, 'app-a', 'introduce', x,
      '{"peerId":"missing","sponsorPeerId":"missing","scope":"database"}' FROM n;`);
    const before = a.group.roster();
    a.db.runScript("CREATE TRIGGER fail_jobs BEFORE INSERT ON sync_group_jobs BEGIN SELECT RAISE(ABORT, 'disk full'); END;");
    expect(() => a.group.remove(c.replica)).toThrow('disk full'); expect(a.group.roster()).toEqual(before);
    expect(a.db.prepare('SELECT COUNT(*) AS n FROM sync_group_jobs WHERE id LIKE ?').get('obsolete-%')).toEqual({ n: 1024 });
    a.db.runScript('DROP TRIGGER fail_jobs;');
    expect(retire(a, c).roster.members).toHaveLength(2);
    expect(a.group.jobs().some((job) => job.kind === 'introduce')).toBe(false);
    expect(a.group.remove(c.replica).roster).toEqual(a.group.roster());
  });

  it('general queue saturation retains reserved removal capacity and fault rollback', () => {
    const a = fixture('a'), b = fixture('b'), c = fixture('c'); found(a, b); join(a, c);
    a.db.runScript(`WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<896)
      INSERT INTO sync_group_jobs (id, peer_id, kind, roster_epoch, payload_json) SELECT 'general-'||x, 'app-a', 'local-revoke', 1,
      '{"peerId":"unknown-'||x||'","scope":"database","localOnly":true}' FROM n;`);
    const before = a.group.roster();
    a.db.runScript("CREATE TRIGGER fail_jobs BEFORE INSERT ON sync_group_jobs BEGIN SELECT RAISE(ABORT, 'disk full'); END;");
    expect(() => a.group.remove(c.replica)).toThrow('disk full'); expect(a.group.roster()).toEqual(before);
    a.db.runScript('DROP TRIGGER fail_jobs;');
    expect(retire(a, c).roster.members).toHaveLength(2);
    expect(a.db.prepare('SELECT COUNT(*) AS n FROM sync_group_jobs').get()).toMatchObject({ n: expect.any(Number) });
    expect((a.db.prepare('SELECT COUNT(*) AS n FROM sync_group_jobs').get() as { n: number }).n).toBeLessThan(1024);
  });
});

describe('copied-database writer quarantine', () => {
  it('is a no-op for standalone, same-identity, and re-run databases', () => {
    const a = fixture('a'), b = fixture('b');
    expect(a.group.quarantineRestoredWriter('app-a')).toEqual({ restored: false });
    found(a, b);
    expect(a.group.quarantineRestoredWriter(a.peer)).toEqual({ restored: false });
    expect(a.group.roster()).not.toBeNull();
    expect(a.db.prepare('SELECT COUNT(*) AS n FROM sync_restore_events').get()).toEqual({ n: 0 });
  });

  it('detaches a copied writer: fresh replica, archived roster, fenced authority, history preserved, rejoin allowed', () => {
    const a = fixture('a'), b = fixture('b'); found(a, b);
    const before = a.group.sync.localRepository()!, roster = a.group.roster()!;
    a.db.prepare("INSERT INTO sync_intents VALUES ('i1', ?, 'doc', 'head', ?, 'scope', 'pending', 1, 1)").run(before.repoId, b.replica);
    a.db.prepare("INSERT INTO sync_peer_known VALUES (?, ?, 'head')").run(before.repoId, b.replica);
    a.db.prepare("INSERT INTO sync_receipts VALUES (?, ?, 'head', 'scope', 'synced', 1)").run(before.repoId, b.replica);
    a.db.prepare('INSERT INTO sync_peer_protocols VALUES (?, ?, 3, 1)').run(before.repoId, b.replica);
    a.db.prepare("INSERT INTO sync_operations VALUES (?, 'op1', ?, 1, 'doc', '[]', 'document', 'h', 'local-authoring', 1)").run(before.repoId, before.replicaId);
    expect(a.group.quarantineRestoredWriter('app-clone')).toEqual({ restored: true });
    const after = a.group.sync.localRepository()!;
    expect(after.replicaId).not.toBe(before.replicaId);
    expect(after.repoId).toBe(before.repoId);
    expect(after.groupId).toBeNull();
    expect(a.group.roster()).toBeNull(); expect(a.group.localPeerId()).toBeNull(); expect(a.group.consent()).toBeNull();
    expect(a.group.jobs()).toEqual([]);
    expect(a.db.prepare("SELECT state FROM sync_intents WHERE id = 'i1'").get()).toEqual({ state: 'blocked' });
    for (const table of ['sync_peer_known', 'sync_peer_protocols', 'sync_receipts']) expect(a.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()).toEqual({ n: 0 });
    expect(a.db.prepare('SELECT COUNT(*) AS n FROM sync_operations').get()).toEqual({ n: 1 });
    const event = a.db.prepare('SELECT * FROM sync_restore_events').get() as Record<string, unknown>;
    expect(event).toMatchObject({ previous_peer_id: 'app-a', current_peer_id: 'app-clone', previous_replica_id: before.replicaId, new_replica_id: after.replicaId });
    expect(JSON.parse(event.roster_json as string).groupId).toBe(roster.groupId);
    expect(a.group.quarantineRestoredWriter('app-clone')).toEqual({ restored: false });
    expect(() => a.group.quarantineRestoredWriter('')).toThrow();
    // Fresh admission under the new identity is allowed again.
    a.group.enable('app-clone', 'app-z', before.repoId, 'replica-z');
    expect(a.group.consent()).toMatchObject({ peerId: 'app-z' });
  });
});

describe('Reset sync with one computer', () => {
  const states = (app: App) => app.group.jobs().map((job) => `${job.kind}:${job.peerId}:${(job.payload as { peerId?: string }).peerId ?? ''}:${job.state}`).sort();

  it('discards only that peer\'s work that already failed; a current member keeps a removed peer\'s revocation', () => {
    const a = fixture('a'), b = fixture('b'); found(a, b);
    a.db.prepare('DELETE FROM sync_group_jobs').run();
    const roster = a.group.roster()!;
    a.group.queueJob(b.peer, 'roster', roster.rosterEpoch, roster);
    a.group.queueJob('app-c', 'roster', roster.rosterEpoch, roster);
    a.group.queueJob(a.peer, 'local-revoke', roster.rosterEpoch, { peerId: b.peer, scope: roster.repoId });
    a.group.queueJob(b.peer, 'revoke', roster.rosterEpoch, { peerId: 'app-c', scope: roster.repoId });
    a.db.prepare("UPDATE sync_group_jobs SET state = 'blocked', error = 'x' WHERE kind <> 'revoke'").run();
    expect(a.group.resetPeer(b.peer)).toBe(1);
    // Never-tried work, another computer's work and a member's revocation of a peer all stay.
    expect(states(a)).toEqual([`local-revoke:${a.peer}:${b.peer}:blocked`, 'revoke:app-b:app-c:pending', 'roster:app-c::blocked']);
    expect(() => a.group.resetPeer('../bad')).toThrow();
  });

  it('after this computer left, the revocation owed to that peer is superseded too; failed work is discarded', () => {
    const a = fixture('a'), b = fixture('b'); found(a, b);
    a.group.remove(a.replica);
    expect(a.group.liveRoster()).toBeNull();
    a.db.prepare("UPDATE sync_group_jobs SET state = 'failed', error = 'x' WHERE kind = 'roster'").run();
    a.db.prepare("UPDATE sync_group_jobs SET state = 'blocked', error = 'x' WHERE kind = 'local-revoke'").run();
    expect(a.group.resetPeer(b.peer)).toBeGreaterThanOrEqual(2);
    expect(a.group.jobs().filter((job) => job.state !== 'done')).toEqual([]);
    expect(a.group.rejoinState(b.peer)).toEqual({ kind: 'detach' });
  });

  it('rejoinState sees open work beyond the 64-row jobs() page', () => {
    const a = fixture('a'), b = fixture('b'); found(a, b);
    a.group.remove(a.replica);
    a.db.prepare("UPDATE sync_group_jobs SET state = 'done'").run();
    const insert = a.db.prepare("INSERT INTO sync_group_jobs (id, peer_id, kind, roster_epoch, payload_json, state) VALUES (?, ?, 'revoke', 1, '{}', ?)");
    for (let i = 0; i < 70; i++) insert.run(`done-${i}`, 'app-c', 'done');
    insert.run('zz-open', 'app-c', 'pending');
    expect(a.group.jobs().some((job) => job.id === 'zz-open')).toBe(false);
    expect(a.group.rejoinState(b.peer)).toMatchObject({ kind: 'blocked' });
  });

  it('resetPeer discards many owed jobs in bulk', () => {
    const a = fixture('a'), b = fixture('b'); found(a, b);
    a.db.prepare('DELETE FROM sync_group_jobs').run();
    const insert = a.db.prepare("INSERT INTO sync_group_jobs (id, peer_id, kind, roster_epoch, payload_json, state) VALUES (?, ?, 'roster', 1, '{}', 'failed')");
    for (let i = 0; i < 1200; i++) insert.run(`j-${i}`, b.peer);
    expect(a.group.resetPeer(b.peer)).toBe(1200);
    expect(a.db.prepare('SELECT COUNT(*) AS n FROM sync_group_jobs').get()).toEqual({ n: 0 });
  });

  it('a failed job is terminal: it never blocks rejoin and is not retried', () => {
    const a = fixture('a'), b = fixture('b'); found(a, b);
    a.group.remove(a.replica);
    a.db.prepare("UPDATE sync_group_jobs SET state = 'failed' WHERE kind = 'roster'").run();
    expect(a.group.removalDeliveryPending(b.peer)).toBe(false);
    a.group.retryJobs();
    expect(a.group.jobs(true).some((job) => job.state === 'failed')).toBe(false);
    a.group.supersedeJob(a.group.jobs().find((job) => job.state === 'failed')!.id, 'n');
    expect(a.group.jobs().some((job) => job.error === 'n')).toBe(false);
  });
});
