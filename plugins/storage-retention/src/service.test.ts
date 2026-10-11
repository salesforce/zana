import fs from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vitest";
import { gate, uuid, type Fixture } from "../test/helpers.js";
import { useStorageFixtures } from "../test/storage-helpers.js";
import type { Policy } from "./contract.js";
import { createService } from "./service.js";
import { ARCHIVE_BATCH_LIMIT, CLEAR_BATCH_LIMIT } from "./rules.js";

const setup = useStorageFixtures();
const DAY = 86_400_000;
const NEVER: Policy = { archiveAfterDays: null, clearAfterDays: null, clearStorageOnArchive: false };

async function serviceSetup(options?: Parameters<typeof setup>[0]) {
  const context = await setup(options);
  const service = createService(context.fixture.host.zcc, context.storage);
  return { ...context, service };
}
const policyOf = (overrides: Partial<Policy>): Policy => ({ ...NEVER, ...overrides });
const entryOf = (fixture: Fixture, id: string) => path.join(fixture.machines.get("host_a")!.root!, id);
const idle = (n: number, days = 40) => ({ id: uuid(n), updatedAt: Date.now() - days * DAY });
const setPolicy = (fixture: Fixture, policy: Policy) => fixture.host.harness.kv.set("policy", policy);

it("starts with every policy off and does nothing until the user opts in", async () => {
  const { fixture, service } = await serviceSetup();
  fixture.addThread(idle(1, 3000));
  fixture.addThread({ id: uuid(2), archivedAt: Date.now() - 3000 * DAY });
  await fixture.addEntry(uuid(2), { "a.bin": 1000 });

  await expect(service.state()).resolves.toEqual({ policy: NEVER, lastRun: null });
  await service.sweep();

  expect(fixture.archived).toEqual([]);
  expect(fixture.hostCalls).toEqual([]);
  expect(await fs.readdir(entryOf(fixture, uuid(2)))).toEqual(["a.bin"]);
  expect((await service.state()).lastRun).toBeNull();
});

it("saves a validated policy, publishes the change and reads it back", async () => {
  const { fixture, service } = await serviceSetup();
  const policy = policyOf({ archiveAfterDays: 30, clearAfterDays: 90, clearStorageOnArchive: true });

  await expect(service.configure(policy)).resolves.toEqual({ policy, lastRun: null });

  expect(fixture.host.harness.published).toContainEqual({ event: "policy-changed", payload: null });
  await expect(service.state()).resolves.toEqual({ policy, lastRun: null });
  for (const bad of [
    { ...NEVER, archiveAfterDays: 0 },
    { ...NEVER, clearAfterDays: 4000 },
    { ...NEVER, archiveAfterDays: 1.5 },
    { ...NEVER, extra: true },
  ])
    await expect(service.configure(bad as Policy)).rejects.toThrow();
  await expect(service.state()).resolves.toEqual({ policy, lastRun: null });
});

it("falls back to every policy off when the stored policy cannot be read", async () => {
  const { fixture, service } = await serviceSetup();
  fixture.addThread(idle(1, 3000));
  await setPolicy(fixture, { archiveAfterDays: "soon" } as unknown as Policy);
  fixture.host.harness.kv.set("lastRun", { ranAt: "yesterday" });

  await expect(service.state()).resolves.toEqual({ policy: NEVER, lastRun: null });
  await service.sweep();

  expect(fixture.archived).toEqual([]);
});

it("previews what a policy would archive and clear without doing either", async () => {
  const { fixture, service } = await serviceSetup();
  fixture.addThread(idle(1));
  fixture.addThread({ ...idle(2), parentThreadId: uuid(1) });
  fixture.addThread({ ...idle(3), parentThreadId: uuid(1), originKind: "fork", visibility: "visible" });
  fixture.addThread(idle(4, 2));
  fixture.addThread({ ...idle(5), pinnedAt: 1 });
  fixture.addThread({ id: uuid(6), archivedAt: Date.now() - 60 * DAY });
  fixture.addThread({ id: uuid(7), archivedAt: Date.now() - 5 * DAY });

  const preview = await service.preview(policyOf({ archiveAfterDays: 30, clearAfterDays: 30 }));

  // Thread 1 takes its spawned child (2) along; the visible fork (3) is its own root.
  expect(preview).toEqual({ archiveCount: 3, clearCount: 1 });
  expect(await service.preview(NEVER)).toEqual({ archiveCount: 0, clearCount: 0 });
  expect(fixture.archived).toEqual([]);
  expect(fixture.hostCalls).toEqual([]);
});

it("archives idle threads past the threshold, leaves the rest, and records the run", async () => {
  const { fixture, service } = await serviceSetup();
  fixture.addThread(idle(1));
  fixture.addThread({ ...idle(2), parentThreadId: uuid(1) });
  fixture.addThread(idle(3, 2));
  fixture.addThread({ ...idle(4), pinnedAt: 1 });
  fixture.addThread({ ...idle(5), status: "active" });
  fixture.addThread({ ...idle(6), status: "starting" });
  fixture.addThread({ ...idle(7), archivedAt: Date.now() - DAY });
  await setPolicy(fixture, policyOf({ archiveAfterDays: 30 }));

  await service.sweep();

  expect(fixture.archived).toEqual([uuid(1)]);
  const { lastRun } = await service.state();
  expect(lastRun).toMatchObject({ archivedCount: 2, clearedCount: 0, failedCount: 0 });
  expect(fixture.host.harness.published).toContainEqual({ event: "changed", payload: null });
});

it("archives and clears at most one batch per sweep, oldest first", async () => {
  const { fixture, service } = await serviceSetup();
  const extra = 12;
  for (let n = 1; n <= ARCHIVE_BATCH_LIMIT + extra; n++) fixture.addThread(idle(n, 1000 - n));
  await setPolicy(fixture, policyOf({ archiveAfterDays: 30 }));

  await service.sweep();

  expect(fixture.archived).toHaveLength(ARCHIVE_BATCH_LIMIT);
  expect(fixture.archived[0]).toBe(uuid(1));
  expect(fixture.archived).not.toContain(uuid(ARCHIVE_BATCH_LIMIT + extra));
  // The next sweep picks up what is left.
  await service.sweep();
  expect(fixture.archived).toHaveLength(ARCHIVE_BATCH_LIMIT + extra);
});

it("reads every thread, hidden ones too, across more than one page", async () => {
  const { fixture, service } = await serviceSetup();
  for (let n = 1; n <= 501; n++) fixture.addThread(idle(n, n === 501 ? 400 : 1));
  fixture.threads.set(uuid(501), { ...fixture.threads.get(uuid(501))!, visibility: "hidden" });
  await setPolicy(fixture, policyOf({ archiveAfterDays: 30 }));

  await service.sweep();

  // The only candidate is the 501st thread, on the second page, hidden.
  expect(fixture.archived).toEqual([uuid(501)]);
});

it("counts a failure, logs it and keeps going", async () => {
  const { fixture, service } = await serviceSetup();
  for (const n of [1, 2, 3]) fixture.addThread(idle(n, 100 - n));
  fixture.onArchive = async (threadId) => {
    if (threadId === uuid(1)) throw new Error("archive refused");
  };
  await setPolicy(fixture, policyOf({ archiveAfterDays: 30 }));

  await service.sweep();

  expect(fixture.archived).toEqual([uuid(2), uuid(3)]);
  expect((await service.state()).lastRun).toMatchObject({ archivedCount: 2, failedCount: 1 });
});

it("does not archive a thread that was used, pinned or archived since the list was built", async () => {
  const { fixture, service } = await serviceSetup();
  for (const n of [1, 2, 3, 4]) fixture.addThread(idle(n, 100 - n));
  fixture.onArchive = async (threadId) => {
    if (threadId !== uuid(1)) return;
    const touch = (n: number, change: object) =>
      fixture.threads.set(uuid(n), { ...fixture.threads.get(uuid(n))!, ...change });
    touch(2, { updatedAt: Date.now() });
    touch(3, { pinnedAt: Date.now() });
    touch(4, { archivedAt: Date.now() });
  };
  await setPolicy(fixture, policyOf({ archiveAfterDays: 30 }));

  await service.sweep();

  expect(fixture.archived).toEqual([uuid(1)]);
  expect((await service.state()).lastRun).toMatchObject({ archivedCount: 1, failedCount: 0 });
});

it("stops the sweep when the policy is changed while it runs", async () => {
  const { fixture, service } = await serviceSetup();
  for (const n of [1, 2, 3]) fixture.addThread(idle(n, 100 - n));
  fixture.onArchive = async (threadId) => {
    if (threadId === uuid(1)) await setPolicy(fixture, policyOf({ archiveAfterDays: 365 }));
  };
  await setPolicy(fixture, policyOf({ archiveAfterDays: 30 }));

  await service.sweep();

  expect(fixture.archived).toEqual([uuid(1)]);
});

it("stops mid-batch without recording a run when the plugin is disposed", async () => {
  const { fixture, service } = await serviceSetup();
  for (const n of [1, 2, 3]) fixture.addThread(idle(n, 100 - n));
  fixture.onArchive = async (threadId) => {
    if (threadId === uuid(1)) await fixture.host.harness.lifecycle.dispose();
  };
  await setPolicy(fixture, policyOf({ archiveAfterDays: 30 }));

  await service.sweep();

  expect(fixture.archived).toEqual([uuid(1)]);
  expect(fixture.host.harness.kv.get("lastRun")).toBeUndefined();
  await expect(service.preview(NEVER)).rejects.toThrow("disabled");
  await expect(service.configure(NEVER)).rejects.toThrow("disabled");
  const calls = fixture.archived.length;
  await service.sweep();
  expect(fixture.archived).toHaveLength(calls);
});

it("never runs two sweeps at once", async () => {
  const { fixture, service } = await serviceSetup();
  fixture.addThread(idle(1));
  const hold = gate();
  fixture.onArchive = () => hold.promise;
  await setPolicy(fixture, policyOf({ archiveAfterDays: 30 }));

  const first = service.sweep();
  await new Promise((resolve) => setTimeout(resolve, 20));
  await service.sweep();
  hold.release();
  await first;

  expect(fixture.archived).toEqual([uuid(1)]);
  expect(fixture.host.harness.published.filter((entry) => entry.event === "changed")).toHaveLength(1);
});

async function clearSetup() {
  const context = await serviceSetup();
  const { fixture } = context;
  const now = Date.now();
  fixture.addThread({ id: uuid(1), archivedAt: now - 100 * DAY });
  fixture.addThread({ id: uuid(2), archivedAt: now - 50 * DAY });
  fixture.addThread({ id: uuid(3), archivedAt: now - 10 * DAY });
  fixture.addThread({ id: uuid(4), archivedAt: now - 100 * DAY, pinnedAt: 1 });
  fixture.addThread({ id: uuid(5), archivedAt: now - 100 * DAY, status: "active" });
  fixture.addThread({ id: uuid(6) });
  for (const n of [1, 2, 3, 4, 5, 6]) await fixture.addEntry(uuid(n), { "a.bin": 8000 });
  await setPolicy(fixture, policyOf({ clearAfterDays: 30 }));
  return context;
}

it("clears the files of threads archived past the threshold, keeping the threads and the other threads' files", async () => {
  const { fixture, service } = await clearSetup();

  await service.sweep();

  for (const n of [1, 2]) expect(await fs.readdir(entryOf(fixture, uuid(n)))).toEqual([]);
  for (const n of [3, 4, 5, 6]) expect(await fs.readdir(entryOf(fixture, uuid(n)))).toEqual(["a.bin"]);
  expect([...fixture.threads.keys()]).toHaveLength(6);
  expect((await service.state()).lastRun).toMatchObject({ archivedCount: 0, clearedCount: 2, failedCount: 0 });
});

it("does not clear the same archive again on later sweeps, but clears it anew after it is archived again", async () => {
  const { fixture, service } = await clearSetup();
  await service.sweep();
  const calls = fixture.hostCalls.length;

  await service.sweep();
  expect(fixture.hostCalls.length).toBe(calls);
  expect((await service.state()).lastRun).toMatchObject({ clearedCount: 0 });

  // Unarchived, used (files come back), archived again long ago: a new archive to clear.
  fixture.threads.set(uuid(1), { ...fixture.threads.get(uuid(1))!, archivedAt: null });
  await service.sweep();
  await fixture.addEntry(uuid(1), { "b.bin": 4000 });
  fixture.threads.set(uuid(1), { ...fixture.threads.get(uuid(1))!, archivedAt: Date.now() - 45 * DAY });
  await service.sweep();

  expect(await fs.readdir(entryOf(fixture, uuid(1)))).toEqual([]);
  expect((await service.state()).lastRun).toMatchObject({ clearedCount: 1 });
});

it("clears at most one batch of archives per sweep", async () => {
  const { fixture, service } = await serviceSetup();
  const total = CLEAR_BATCH_LIMIT + 5;
  for (let n = 1; n <= total; n++) {
    fixture.addThread({ id: uuid(n), archivedAt: Date.now() - (500 - n) * DAY });
    await fixture.addEntry(uuid(n), { "a.bin": 1000 });
  }
  await setPolicy(fixture, policyOf({ clearAfterDays: 30 }));

  await service.sweep();
  expect((await service.state()).lastRun).toMatchObject({ clearedCount: CLEAR_BATCH_LIMIT });
  await service.sweep();
  expect((await service.state()).lastRun).toMatchObject({ clearedCount: 5 });
});

it("counts a machine that cannot be reached as a failure and still clears the others", async () => {
  const { fixture, service } = await serviceSetup({ machines: [{ id: "host_a" }, { id: "host_b" }] });
  const now = Date.now();
  fixture.addThread({ id: uuid(1), hostId: "host_a", archivedAt: now - 100 * DAY });
  fixture.addThread({ id: uuid(2), hostId: "host_b", archivedAt: now - 90 * DAY });
  await fixture.addEntry(uuid(1), { "a.bin": 1000 }, "host_a");
  await fixture.addEntry(uuid(2), { "a.bin": 1000 }, "host_b");
  fixture.machines.get("host_a")!.online = false;
  await setPolicy(fixture, policyOf({ clearAfterDays: 30 }));

  await service.sweep();

  expect(await fs.readdir(path.join(fixture.machines.get("host_b")!.root!, uuid(2)))).toEqual([]);
  expect(await fs.readdir(path.join(fixture.machines.get("host_a")!.root!, uuid(1)))).toEqual(["a.bin"]);
  expect((await service.state()).lastRun).toMatchObject({ clearedCount: 1, failedCount: 1 });
});

it("leaves an archive alone when the thread is pinned or restarted after the list was built", async () => {
  const { fixture, service } = await clearSetup();
  fixture.intercept("discard", async (_call, forward) => {
    // Between listing and clearing the user pins the second archive.
    fixture.threads.set(uuid(2), { ...fixture.threads.get(uuid(2))!, pinnedAt: Date.now() });
    fixture.clearInterceptors();
    return forward();
  });

  await service.sweep();

  expect(await fs.readdir(entryOf(fixture, uuid(2)))).toEqual(["a.bin"]);
  expect((await service.state()).lastRun).toMatchObject({ clearedCount: 1, failedCount: 0 });
});
