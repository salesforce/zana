import fs from "node:fs/promises";
import path from "node:path";
import type { PluginThreadEvent } from "@zana-ai/zcc-plugin-sdk/server";
import { afterEach, expect, it, vi } from "vitest";
import plugin from "./server.js";
import { ARCHIVE_GRACE_MS } from "./src/rules.js";
import { settled, uuid, type Fixture } from "./test/helpers.js";
import { useStorageFixtures } from "./test/storage-helpers.js";

const setup = useStorageFixtures();
const ARCHIVED_AT = 1_700_000_000_000;
const DAY = 86_400_000;

afterEach(() => {
  vi.restoreAllMocks();
});

async function pluginSetup(options?: Parameters<typeof setup>[0]) {
  const context = await setup(options);
  await plugin(context.fixture.host.zcc);
  const harness = context.fixture.host.harness;
  const queued = () =>
    (context.fixture.database.prepare("SELECT thread_id FROM archive_cleanup").all() as unknown[]).length;
  return { ...context, harness, queued };
}
const entryOf = (fixture: Fixture, id: string) => path.join(fixture.machines.get("host_a")!.root!, id);
const emptied = (fixture: Fixture, id: string) =>
  settled(async () => (await fs.readdir(entryOf(fixture, id))).length === 0);
const clearOnArchive = { archiveAfterDays: null, clearAfterDays: null, clearStorageOnArchive: true };
const at = (time: number) => vi.spyOn(Date, "now").mockReturnValue(time);

it("registers its panel methods, command line, schedules and thread listeners", async () => {
  const { harness } = await pluginSetup();

  await expect(harness.callRpc("state")).resolves.toEqual({
    policy: { archiveAfterDays: null, clearAfterDays: null, clearStorageOnArchive: false },
    lastRun: null,
  });
  expect(harness.cli?.name).toBe("storage");
  expect(harness.schedules.map((row) => [row.name, row.cron])).toEqual([
    ["archive-storage-cleanup", "* * * * *"],
    ["retention", "0 * * * *"],
  ]);
  expect(harness.events.map((row) => row.name).sort()).toEqual([
    "thread.archived",
    "thread.failed",
    "thread.idle",
  ]);
});

it("lists machines and scans one through the registered methods", async () => {
  const { fixture, harness } = await pluginSetup();
  fixture.addThread({ id: uuid(1) });
  await fixture.addEntry(uuid(1), { "a.bin": 4000 });

  const listed = (await harness.callRpc("hosts")) as { hosts: Array<{ hostId: string }> };
  expect(listed.hosts.map((host) => host.hostId)).toEqual(["host_a"]);
  const started = (await harness.callRpc("scanHost", { hostId: "host_a" })) as { scan: { state: string } };
  expect(started.scan.state).toBe("scanning");
  const done = await settled(async () => {
    const host = (await harness.callRpc("host", { hostId: "host_a" })) as { scan: { state: string } };
    return host.scan.state !== "scanning";
  });
  expect(done).toBe(true);
  const all = (await harness.callRpc("scanAll")) as { hosts: unknown[] };
  expect(all.hosts).toHaveLength(1);
});

it.each([
  ["host", {}],
  ["host", { hostId: "" }],
  ["host", { hostId: "host_a", extra: 1 }],
  ["scanHost", null],
  ["clearThread", { threadId: "" }],
  ["clearThread", { threadId: "x", force: true }],
  ["clearLargeFiles", { hostId: undefined }],
  ["configure", { archiveAfterDays: 0, clearAfterDays: null, clearStorageOnArchive: false }],
  ["configure", { archiveAfterDays: null, clearAfterDays: null, clearStorageOnArchive: "yes" }],
  ["preview", { archiveAfterDays: null, clearAfterDays: 9999, clearStorageOnArchive: false }],
  ["startRemoveOrphans", "host_a"],
])("rejects %s with %j before anything runs", async (method, input) => {
  const { fixture, harness } = await pluginSetup();

  await expect(harness.callRpc(method, input)).rejects.toThrow(`Invalid input for ${method}`);

  expect(fixture.hostCalls).toEqual([]);
  expect(harness.kv.has("policy")).toBe(false);
});

it("saves the policy through configure and previews it without changing anything", async () => {
  const { fixture, harness } = await pluginSetup();
  fixture.addThread({ id: uuid(1), updatedAt: Date.now() - 90 * DAY });
  const policy = { archiveAfterDays: 30, clearAfterDays: null, clearStorageOnArchive: false };

  await expect(harness.callRpc("preview", policy)).resolves.toEqual({ archiveCount: 1, clearCount: 0 });
  expect(harness.kv.has("policy")).toBe(false);
  await expect(harness.callRpc("configure", policy)).resolves.toEqual({ policy, lastRun: null });
  await expect(harness.callRpc("state")).resolves.toEqual({ policy, lastRun: null });
  expect(fixture.archived).toEqual([]);
});

it("returns only the documented fields", async () => {
  const { harness } = await pluginSetup();
  harness.kv.set("lastRun", { ranAt: 5, archivedCount: 1, clearedCount: 2, failedCount: 0, leaked: "secret" });

  const state = (await harness.callRpc("state")) as { lastRun: object };

  expect(state.lastRun).toEqual({ ranAt: 5, archivedCount: 1, clearedCount: 2, failedCount: 0 });
});

it("clears the files of a thread archived while clearing on archive is on, once the undo window passes", async () => {
  const { fixture, harness, queued } = await pluginSetup();
  await harness.callRpc("configure", clearOnArchive);
  const thread = fixture.addThread({ id: uuid(1), archivedAt: ARCHIVED_AT });
  await fixture.addEntry(uuid(1), { "a.bin": 5000 });

  at(ARCHIVED_AT + 1000);
  const first = await harness.emitThreadEvent("thread.archived", { thread });
  expect(first.errors).toEqual([]);
  expect(queued()).toBe(1);
  expect(await fs.readdir(entryOf(fixture, uuid(1)))).toEqual(["a.bin"]);

  at(ARCHIVED_AT + ARCHIVE_GRACE_MS);
  await harness.emitThreadEvent("thread.idle", { thread });
  expect(await emptied(fixture, uuid(1))).toBe(true);
  expect(queued()).toBe(0);
});

it("drains the queue from the minute schedule and from a failed thread too", async () => {
  const { fixture, harness } = await pluginSetup();
  await harness.callRpc("configure", clearOnArchive);
  const first = fixture.addThread({ id: uuid(1), archivedAt: ARCHIVED_AT });
  const second = fixture.addThread({ id: uuid(2), archivedAt: ARCHIVED_AT });
  for (const n of [1, 2]) await fixture.addEntry(uuid(n), { "a.bin": 5000 });
  at(ARCHIVED_AT + 1000);
  await harness.emitThreadEvent("thread.archived", { thread: first });
  await harness.emitThreadEvent("thread.archived", { thread: second });

  at(ARCHIVED_AT + ARCHIVE_GRACE_MS);
  await harness.runSchedule("archive-storage-cleanup");

  for (const n of [1, 2]) expect(await emptied(fixture, uuid(n))).toBe(true);
  const third = fixture.addThread({ id: uuid(3), archivedAt: ARCHIVED_AT });
  await fixture.addEntry(uuid(3), { "a.bin": 5000 });
  at(ARCHIVED_AT + 1000);
  await harness.emitThreadEvent("thread.archived", { thread: third });
  at(ARCHIVED_AT + ARCHIVE_GRACE_MS);
  await harness.emitThreadEvent("thread.failed", { thread: third });
  expect(await emptied(fixture, uuid(3))).toBe(true);
});

it.each([
  ["clearing on archive is off", { archivedAt: ARCHIVED_AT }, false],
  ["the thread is pinned", { archivedAt: ARCHIVED_AT, pinnedAt: ARCHIVED_AT }, true],
  ["the thread is not archived", { archivedAt: null }, true],
] as const)("queues nothing when %s", async (_name, change, enabled) => {
  const { fixture, harness, queued } = await pluginSetup();
  if (enabled) await harness.callRpc("configure", clearOnArchive);
  const thread = fixture.addThread({ id: uuid(1), ...change });
  await fixture.addEntry(uuid(1), { "a.bin": 5000 });

  at(ARCHIVED_AT + 10 * ARCHIVE_GRACE_MS);
  const result = await harness.emitThreadEvent("thread.archived", { thread });

  expect(result.errors).toEqual([]);
  expect(queued()).toBe(0);
  expect(await fs.readdir(entryOf(fixture, uuid(1)))).toEqual(["a.bin"]);
});

it("looks the thread up when the event does not carry it, and ignores one that is gone", async () => {
  const { fixture, harness, queued } = await pluginSetup();
  await harness.callRpc("configure", clearOnArchive);
  fixture.addThread({ id: uuid(1), archivedAt: ARCHIVED_AT });
  const handler = harness.events.find((row) => row.name === "thread.archived")!.handler;
  const event = (threadId: string) =>
    ({
      id: "e",
      schemaVersion: 1,
      sequence: 1,
      timestamp: ARCHIVED_AT,
      name: "thread.archived",
      threadId,
    }) as PluginThreadEvent;

  at(ARCHIVED_AT + 1000);
  await handler(event(uuid(404)));
  expect(queued()).toBe(0);
  await handler(event(uuid(1)));
  expect(queued()).toBe(1);
});

it("applies the retention policy from the hourly schedule", async () => {
  const { fixture, harness } = await pluginSetup();
  fixture.addThread({ id: uuid(1), updatedAt: Date.now() - 90 * DAY });
  fixture.addThread({ id: uuid(2), updatedAt: Date.now() });
  await harness.callRpc("configure", { archiveAfterDays: 30, clearAfterDays: null, clearStorageOnArchive: false });

  await harness.runSchedule("retention");

  expect(fixture.archived).toEqual([uuid(1)]);
  const state = (await harness.callRpc("state")) as { lastRun: { archivedCount: number } };
  expect(state.lastRun.archivedCount).toBe(1);
});

it("does nothing on a schedule with the default policy", async () => {
  const { fixture, harness } = await pluginSetup();
  fixture.addThread({ id: uuid(1), updatedAt: Date.now() - 900 * DAY });

  await harness.runSchedule();

  expect(fixture.archived).toEqual([]);
  expect(fixture.hostCalls).toEqual([]);
});

it("stops answering and acting once the plugin is disposed", async () => {
  const { fixture, harness } = await pluginSetup();
  fixture.addThread({ id: uuid(1), updatedAt: Date.now() - 90 * DAY });
  await harness.callRpc("configure", { archiveAfterDays: 30, clearAfterDays: null, clearStorageOnArchive: false });

  await harness.lifecycle.dispose();

  await expect(
    harness.callRpc("configure", { archiveAfterDays: 1, clearAfterDays: null, clearStorageOnArchive: false }),
  ).rejects.toThrow("disabled");
  await harness.runSchedule("retention");
  expect(fixture.archived).toEqual([]);
});

const scanned = async (harness: { callRpc: (name: string, input?: unknown) => Promise<unknown> }) => {
  await harness.callRpc("scanHost", { hostId: "host_a" });
  await settled(async () => {
    const host = (await harness.callRpc("host", { hostId: "host_a" })) as { scan: { state: string } };
    return host.scan.state !== "scanning";
  });
};

it.each([
  ["startRemoveOrphans", { hostId: "host_a" }],
  ["removeOrphans", { hostId: "host_a" }],
  ["startClearLargeFiles", { hostId: "host_a" }],
  ["clearLargeFiles", { hostId: "host_a" }],
  ["startClearArchivedFiles", { hostId: "host_a" }],
  ["clearArchivedFiles", { hostId: "host_a" }],
])("refuses %s on a machine that was not scanned, and routes it after a scan", async (method, input) => {
  const { fixture, harness } = await pluginSetup();
  fixture.addThread({ id: uuid(1) });
  await fixture.addEntry(uuid(1), { "keep.bin": 4000 });

  await expect(harness.callRpc(method, input)).rejects.toThrow(/Scan the machine/);
  await scanned(harness);
  await expect(harness.callRpc(method, input)).resolves.toBeDefined();

  // An active thread and an empty candidate list: nothing may be removed.
  expect(await fs.readdir(entryOf(fixture, uuid(1)))).toEqual(["keep.bin"]);
});

it("starts the large-file cleanup for every machine and finds nothing to do before a scan", async () => {
  const { fixture, harness } = await pluginSetup();
  fixture.addThread({ id: uuid(1) });
  await fixture.addEntry(uuid(1), { "keep.bin": 4000 });

  await expect(harness.callRpc("startClearLargeFiles", { hostId: null })).resolves.toBeNull();

  expect(fixture.hostCalls).toEqual([]);
  expect(await fs.readdir(entryOf(fixture, uuid(1)))).toEqual(["keep.bin"]);
});

it("clears the files of a stopped thread through clearThread", async () => {
  const { fixture, harness } = await pluginSetup();
  fixture.addThread({ id: uuid(1) });
  await fixture.addEntry(uuid(1), { "a.bin": 4000 });

  await expect(harness.callRpc("clearThread", { threadId: uuid(1) })).resolves.toBeDefined();

  expect(await emptied(fixture, uuid(1))).toBe(true);
});
