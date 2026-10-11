import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { gate, settled, uuid, type Fixture } from "../test/helpers.js";
import { useStorageFixtures } from "../test/storage-helpers.js";
import { createStorage } from "./storage.js";
import { ARCHIVE_GRACE_MS } from "./rules.js";

const setup = useStorageFixtures();
const ARCHIVED_AT = 1_700_000_000_000;
const enabled = async () => true;
const entryOf = (fixture: Fixture, id: string) => path.join(fixture.machines.get("host_a")!.root!, id);
const emptied = (fixture: Fixture, id: string) =>
  settled(async () => (await fs.readdir(entryOf(fixture, id))).length === 0);

afterEach(() => {
  vi.restoreAllMocks();
});

async function queued(overrides: Partial<{ pinnedAt: number | null; status: string }> = {}) {
  const context = await setup();
  context.fixture.addThread({ id: uuid(1), archivedAt: ARCHIVED_AT, ...overrides });
  await context.fixture.addEntry(uuid(1), { "a.bin": 5_000 });
  context.storage.queueArchivedStorage(uuid(1), ARCHIVED_AT);
  return context;
}
const at = (time: number) => vi.spyOn(Date, "now").mockReturnValue(time);

it("waits out the undo window, then clears the archived thread's files once", async () => {
  const { fixture, storage } = await queued();

  at(ARCHIVED_AT + ARCHIVE_GRACE_MS - 1);
  await storage.clearPendingArchives(enabled);
  expect(await fs.readdir(entryOf(fixture, uuid(1)))).toEqual(["a.bin"]);

  at(ARCHIVED_AT + ARCHIVE_GRACE_MS);
  await storage.clearPendingArchives(enabled);
  expect(await emptied(fixture, uuid(1))).toBe(true);
  expect(storage.clearedArchives().get(uuid(1))).toBe(ARCHIVED_AT);

  const calls = fixture.hostCalls.length;
  await storage.clearPendingArchives(enabled);
  expect(fixture.hostCalls.length).toBe(calls);
});

it.each([
  ["unarchived", { archivedAt: null }],
  ["pinned", { pinnedAt: ARCHIVED_AT }],
  ["archived again", { archivedAt: ARCHIVED_AT + 5 }],
] as const)("forgets a queued cleanup once the thread was %s", async (_name, change) => {
  const { fixture, storage } = await queued();
  fixture.threads.set(uuid(1), { ...fixture.threads.get(uuid(1))!, ...change });

  at(ARCHIVED_AT + 10 * ARCHIVE_GRACE_MS);
  await storage.clearPendingArchives(enabled);
  // Back to the state it was queued for: the cancelled cleanup does not come back.
  fixture.threads.set(uuid(1), {
    ...fixture.threads.get(uuid(1))!,
    archivedAt: ARCHIVED_AT,
    pinnedAt: null,
  });
  await storage.clearPendingArchives(enabled);

  expect(await fs.readdir(entryOf(fixture, uuid(1)))).toEqual(["a.bin"]);
});

it("forgets a queued cleanup for a thread that no longer exists", async () => {
  const { fixture, storage } = await queued();
  fixture.threads.delete(uuid(1));

  at(ARCHIVED_AT + 10 * ARCHIVE_GRACE_MS);
  await storage.clearPendingArchives(enabled);
  fixture.addThread({ id: uuid(1), archivedAt: ARCHIVED_AT });
  await storage.clearPendingArchives(enabled);

  expect(await fs.readdir(entryOf(fixture, uuid(1)))).toEqual(["a.bin"]);
});

it("keeps a cleanup queued while the thread is running and clears it once it stops", async () => {
  const { fixture, storage } = await queued({ status: "active" });

  at(ARCHIVED_AT + 10 * ARCHIVE_GRACE_MS);
  await storage.clearPendingArchives(enabled);
  expect(await fs.readdir(entryOf(fixture, uuid(1)))).toEqual(["a.bin"]);

  fixture.threads.set(uuid(1), { ...fixture.threads.get(uuid(1))!, status: "idle" });
  await storage.clearPendingArchives(enabled);
  expect(await emptied(fixture, uuid(1))).toBe(true);
});

it("retries a cleanup the machine could not do, instead of dropping it", async () => {
  const { fixture, storage } = await queued();
  fixture.machines.get("host_a")!.online = false;

  at(ARCHIVED_AT + 10 * ARCHIVE_GRACE_MS);
  await expect(storage.clearPendingArchives(enabled)).resolves.toBeUndefined();
  expect(await fs.readdir(entryOf(fixture, uuid(1)))).toEqual(["a.bin"]);

  fixture.machines.get("host_a")!.online = true;
  await storage.clearPendingArchives(enabled);
  expect(await emptied(fixture, uuid(1))).toBe(true);
});

it("gives up on a cleanup that has been queued for over a week", async () => {
  const { fixture, storage } = await queued({ status: "active" });

  at(ARCHIVED_AT + 8 * 86_400_000);
  await storage.clearPendingArchives(enabled);
  // Even once the thread stops, the dropped cleanup does not come back.
  fixture.threads.set(uuid(1), { ...fixture.threads.get(uuid(1))!, status: "idle" });
  await storage.clearPendingArchives(enabled);

  expect(await fs.readdir(entryOf(fixture, uuid(1)))).toEqual(["a.bin"]);
});

it("drops the queue when the policy is switched off", async () => {
  const { fixture, storage } = await queued();

  at(ARCHIVED_AT + 10 * ARCHIVE_GRACE_MS);
  await storage.clearPendingArchives(async () => false);
  await storage.clearPendingArchives(enabled);

  expect(await fs.readdir(entryOf(fixture, uuid(1)))).toEqual(["a.bin"]);
});

it("cancels a queued cleanup on request", async () => {
  const { fixture, storage } = await queued();
  storage.cancelArchivedStorage(uuid(1));

  at(ARCHIVED_AT + 10 * ARCHIVE_GRACE_MS);
  await storage.clearPendingArchives(enabled);

  expect(await fs.readdir(entryOf(fixture, uuid(1)))).toEqual(["a.bin"]);
});

it("clears the oldest archives first and never overlaps two drains", async () => {
  const { fixture, storage } = await setup();
  for (const [n, archivedAt] of [[1, ARCHIVED_AT + 20], [2, ARCHIVED_AT + 10], [3, ARCHIVED_AT + 30]] as const) {
    fixture.addThread({ id: uuid(n), archivedAt });
    await fixture.addEntry(uuid(n), { "a.bin": 1000 });
    storage.queueArchivedStorage(uuid(n), archivedAt);
  }
  const hold = gate();
  const order: string[] = [];
  fixture.intercept("discard", async (call, forward) => {
    order.push((call.input as { names: string[] }).names[0]!);
    await hold.promise;
    return forward();
  });

  at(ARCHIVED_AT + 10 * ARCHIVE_GRACE_MS);
  const first = storage.clearPendingArchives(enabled);
  const overlapping = storage.clearPendingArchives(enabled);
  await overlapping;
  hold.release();
  await first;

  expect(order).toEqual([uuid(2), uuid(1), uuid(3)]);
});

it("survives a reload: the queue is kept in the database", async () => {
  const { fixture, storage } = await queued();
  expect(storage).toBeDefined();
  const reloaded = createStorage(fixture.host.zcc);

  at(ARCHIVED_AT + 10 * ARCHIVE_GRACE_MS);
  await reloaded.clearPendingArchives(enabled);

  expect(await emptied(fixture, uuid(1))).toBe(true);
});

it("does not start a drain after the plugin was disposed", async () => {
  const { fixture, storage } = await queued();
  await fixture.host.harness.lifecycle.dispose();
  const calls = fixture.hostCalls.length;

  at(ARCHIVED_AT + 10 * ARCHIVE_GRACE_MS);
  await storage.clearPendingArchives(enabled);

  expect(fixture.hostCalls.length).toBe(calls);
});
