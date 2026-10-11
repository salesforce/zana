import fs from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vitest";
import { age, gate, listRoot, settled, uuid, type Fixture } from "../test/helpers.js";
import {
  HOUR,
  scan,
  trashName,
  until,
  useStorageFixtures,
  waitForScan,
} from "../test/storage-helpers.js";
import { LARGE_FILE_MIN_BYTES } from "./rules.js";

const setup = useStorageFixtures();
const BIG = LARGE_FILE_MIN_BYTES + 4096;
const rootOf = (fixture: Fixture, hostId = "host_a") => fixture.machines.get(hostId)!.root!;
const gone = (fixture: Fixture, name: string) =>
  settled(async () => !(await listRoot(fixture)).includes(name));

// ---- orphans ------------------------------------------------------------------

it("removes old orphaned folders and stale trash, and nothing else", async () => {
  const { fixture, storage } = await setup();
  const stale = trashName(uuid(901), uuid(902));
  fixture.addThread({ id: uuid(1) });
  await fixture.addEntry(uuid(1), { "a.bin": 20_000 });
  await fixture.addEntry(uuid(10), { "a.bin": 30_000 });
  await fixture.addEntry(uuid(11), { "a.bin": 10_000 });
  await fixture.addEntry(stale, { "a.bin": 5_000 });
  await fixture.addEntry("model-list", { "a.bin": 5_000 });
  for (const name of [uuid(10), stale]) await age(path.join(rootOf(fixture), name), HOUR);
  await scan(storage);

  const result = await storage.removeOrphans({ hostId: "host_a" });

  // The young folder (uuid 11) could still be a thread storage being set up: left alone.
  expect(result.removedCount).toBe(2);
  expect(result.skippedCount).toBe(1);
  expect(result.removedBytes).toBeGreaterThanOrEqual(35_000);
  expect(result.report.orphanCount).toBe(1);
  expect(result.report.threadsWithStorageCount).toBe(1);
  expect(await gone(fixture, uuid(10))).toBe(true);
  expect(await gone(fixture, stale)).toBe(true);
  expect(await listRoot(fixture)).toEqual([uuid(1), uuid(11), "model-list"].sort());
  // The cached report no longer lists what was removed.
  expect((await storage.host({ hostId: "host_a" })).report?.orphanCount).toBe(1);
});

it("keeps a folder whose thread a paged list missed but a lookup by id still finds", async () => {
  const { fixture, storage } = await setup();
  fixture.addThread({ id: uuid(10) });
  await fixture.addEntry(uuid(10), { "a.bin": 20_000 });
  await age(path.join(rootOf(fixture), uuid(10)), HOUR);
  await scan(storage);
  // A row deleted earlier in the list shifts this one out of every page read from now on.
  const list = fixture.host.zcc.sdk.threads.list;
  fixture.host.zcc.sdk.threads.list = async (args) => (await list(args)).filter((row) => row.id !== uuid(10));

  const result = await storage.removeOrphans({ hostId: "host_a" });

  expect(result.removedCount).toBe(0);
  expect(await listRoot(fixture)).toEqual([uuid(10)]);
});

it("does not remove a folder a thread has claimed since the scan", async () => {
  const { fixture, storage } = await setup();
  await fixture.addEntry(uuid(10), { "a.bin": 20_000 });
  await age(path.join(rootOf(fixture), uuid(10)), HOUR);
  await scan(storage);
  fixture.addThread({ id: uuid(10) });

  const result = await storage.removeOrphans({ hostId: "host_a" });

  expect(result.removedCount).toBe(0);
  expect(result.report.orphanCount).toBe(0);
  expect(await listRoot(fixture)).toEqual([uuid(10)]);
});

it("needs a scan, and a machine that answers, before removing orphans", async () => {
  const { fixture, storage } = await setup();
  await expect(storage.removeOrphans({ hostId: "host_a" })).rejects.toThrow(
    "Scan the machine before removing orphaned storage",
  );
  await expect(storage.removeOrphans({ hostId: "host_missing" })).rejects.toThrow("Unknown machine");
  await fixture.addEntry(uuid(10), { "a.bin": 20_000 });
  await age(path.join(rootOf(fixture), uuid(10)), HOUR);
  await scan(storage);
  fixture.machines.get("host_a")!.online = false;

  await expect(storage.removeOrphans({ hostId: "host_a" })).rejects.toThrow("Machine host_a is offline");

  expect(await listRoot(fixture)).toEqual([uuid(10)]);
});

it("removes orphans in the background and reports how it went", async () => {
  const { fixture, storage } = await setup();
  await fixture.addEntry(uuid(10), { "a.bin": 20_000 });
  await age(path.join(rootOf(fixture), uuid(10)), HOUR);
  await scan(storage);
  const hold = gate();
  fixture.intercept("discard", async (_call, forward) => {
    await hold.promise;
    return forward();
  });

  await expect(storage.startRemoveOrphans({ hostId: "host_a" })).resolves.toBeNull();
  expect((await storage.host({ hostId: "host_a" })).maintenance).toEqual({ state: "running" });
  await expect(storage.startRemoveOrphans({ hostId: "host_a" })).rejects.toThrow("already running");
  hold.release();

  const done = await until(
    () => storage.host({ hostId: "host_a" }),
    (response) => response.maintenance.state !== "running",
  );
  expect(done.maintenance).toEqual({ state: "completed", message: "Removed 1 orphaned storage folder" });
  expect(done.report?.orphanCount).toBe(0);
});

it("reports a failed background orphan removal and can run it again", async () => {
  const { fixture, storage } = await setup();
  await fixture.addEntry(uuid(10), { "a.bin": 20_000 });
  await age(path.join(rootOf(fixture), uuid(10)), HOUR);
  await scan(storage);
  fixture.intercept("discard", async () => {
    throw new Error("host disconnected");
  });

  await storage.startRemoveOrphans({ hostId: "host_a" });
  const failed = await until(
    () => storage.host({ hostId: "host_a" }),
    (response) => response.maintenance.state !== "running",
  );
  expect(failed.maintenance).toEqual({ state: "failed", message: "host disconnected" });

  fixture.clearInterceptors();
  await storage.startRemoveOrphans({ hostId: "host_a" });
  const retried = await until(
    () => storage.host({ hostId: "host_a" }),
    (response) => response.maintenance.state === "completed",
  );
  expect(retried.maintenance.state).toBe("completed");
  await expect(storage.startRemoveOrphans({ hostId: "host_missing" })).rejects.toThrow("Unknown machine");
});

it("refuses to start background orphan removal before a scan", async () => {
  const { storage } = await setup();
  await expect(storage.startRemoveOrphans({ hostId: "host_a" })).rejects.toThrow(
    "Scan the machine before cleaning up storage",
  );
});

// ---- one thread -----------------------------------------------------------------

it("empties a stopped thread's folder but keeps the folder and the thread", async () => {
  const { fixture, storage } = await setup();
  fixture.addThread({ id: uuid(1) });
  fixture.addThread({ id: uuid(2) });
  const directory = await fixture.addEntry(uuid(1), { "a.bin": 20_000, "nested/b.bin": 20_000 });
  await fixture.addEntry(uuid(2), { "a.bin": 20_000 });
  await scan(storage);

  await expect(storage.clearThread({ threadId: uuid(1) })).resolves.toEqual({ ok: true });

  expect(await settled(async () => (await fs.readdir(directory)).length === 0)).toBe(true);
  expect((await fs.stat(directory)).isDirectory()).toBe(true);
  expect((await fs.stat(directory)).mode & 0o777).toBe(0o700);
  expect(await fs.readdir(path.join(rootOf(fixture), uuid(2)))).toEqual(["a.bin"]);
  const { report } = await storage.host({ hostId: "host_a" });
  expect(report?.largestThreads.map((thread) => thread.threadId)).toEqual([uuid(2)]);
  expect(fixture.host.harness.published.some((event) => event.event === "changed")).toBe(true);
});

it("clears a thread without needing a scan, and treats a missing or empty folder as already cleared", async () => {
  const { fixture, storage } = await setup();
  fixture.addThread({ id: uuid(1) });
  fixture.addThread({ id: uuid(2) });
  await fixture.addEntry(uuid(2), {});

  await expect(storage.clearThread({ threadId: uuid(1) })).resolves.toEqual({ ok: true });
  await expect(storage.clearThread({ threadId: uuid(2) })).resolves.toEqual({ ok: true });
  expect(await listRoot(fixture)).toEqual([uuid(2)]);
});

it("will not clear a thread that is running, unknown, or on a machine that is not answering", async () => {
  const { fixture, storage } = await setup();
  fixture.addThread({ id: uuid(1), status: "active" });
  fixture.addThread({ id: uuid(2), status: "starting" });
  fixture.addThread({ id: uuid(3), status: "stopping" });
  fixture.addThread({ id: uuid(4), hostId: "host_gone" });
  const directory = await fixture.addEntry(uuid(1), { "a.bin": 1000 });

  for (const id of [uuid(1), uuid(2), uuid(3)])
    await expect(storage.clearThread({ threadId: id })).rejects.toThrow(
      "Stop the thread before clearing its storage",
    );
  await expect(storage.clearThread({ threadId: uuid(99) })).rejects.toThrow("Thread not found");
  await expect(storage.clearThread({ threadId: uuid(4) })).rejects.toThrow("Unknown machine");
  expect(await fs.readdir(directory)).toEqual(["a.bin"]);
});

it("never follows a symbolic link out of the thread-storage root", async () => {
  const { fixture, storage } = await setup();
  const outside = await fixture.tmp();
  await fs.writeFile(path.join(outside, "keep.txt"), "precious");
  fixture.addThread({ id: uuid(1) });
  fixture.addThread({ id: uuid(2), archivedAt: Date.now() - HOUR });
  await fs.symlink(outside, path.join(rootOf(fixture), uuid(1)));
  await fs.symlink(outside, path.join(rootOf(fixture), uuid(2)));

  await expect(storage.clearThread({ threadId: uuid(1) })).rejects.toThrow("left untouched");
  await scan(storage);
  await expect(storage.clearArchivedFiles({ hostId: "host_a" })).resolves.toMatchObject({ clearedThreads: 0 });
  await expect(storage.clearLargeFiles({ hostId: "host_a" })).resolves.toEqual({ clearedFiles: 0, clearedBytes: 0 });

  expect(await fs.readFile(path.join(outside, "keep.txt"), "utf8")).toBe("precious");
});

it("clears different threads concurrently, excludes overlapping maintenance and releases locks after success or failure", async () => {
  const { fixture, storage } = await setup();
  fixture.addThread({ id: uuid(1) });
  fixture.addThread({ id: uuid(2) });
  await fixture.addEntry(uuid(1), { "a.bin": 10_000 });
  await fixture.addEntry(uuid(2), { "a.bin": 10_000 });
  await scan(storage);
  const pending = new Map<string, { release: () => void; fail: (error: Error) => void }>();
  let hold = true;
  fixture.intercept("discard", async (call, forward) => {
    if (!hold) return forward();
    const [name] = (call.input as { names: string[] }).names;
    const blocked = gate();
    pending.set(name!, { release: blocked.release, fail: blocked.fail });
    await blocked.promise;
    return forward();
  });

  const first = storage.clearThread({ threadId: uuid(1) });
  const second = storage.clearThread({ threadId: uuid(2) });
  const secondFailure = expect(second).rejects.toThrow("host disconnected");
  await expect.poll(() => pending.size).toBe(2);
  await expect(storage.clearThread({ threadId: uuid(1) })).rejects.toThrow("already being cleared");
  await expect(storage.removeOrphans({ hostId: "host_a" })).rejects.toThrow("already running");
  await expect(storage.clearArchivedFiles({ hostId: "host_a" })).rejects.toThrow("already running");

  pending.get(uuid(1))!.release();
  await first;
  expect(
    (await storage.host({ hostId: "host_a" })).report?.largestThreads.map((thread) => thread.threadId),
  ).toEqual([uuid(2)]);
  pending.get(uuid(2))!.fail(new Error("host disconnected"));
  await secondFailure;

  hold = false;
  await storage.clearThread({ threadId: uuid(2) });
  expect((await storage.host({ hostId: "host_a" })).report?.threadsWithStorageCount).toBe(0);
  await expect(storage.removeOrphans({ hostId: "host_a" })).resolves.toMatchObject({ removedCount: 0 });
});

// ---- large files ------------------------------------------------------------------

async function largeFileScenario() {
  const context = await setup();
  const { fixture } = context;
  const now = Date.now();
  fixture.addThread({ id: uuid(1), archivedAt: now - HOUR });
  fixture.addThread({ id: uuid(2), archivedAt: now - HOUR, pinnedAt: now - 2 * HOUR });
  fixture.addThread({ id: uuid(3) });
  fixture.addThread({ id: uuid(4), archivedAt: now - HOUR, status: "active" });
  fixture.addThread({ id: uuid(5), archivedAt: now - 1_000 });
  for (const n of [1, 2, 3, 4, 5]) await fixture.addEntry(uuid(n), { "big.bin": BIG, "small.txt": 1000 });
  await fixture.addEntry(uuid(9), { "big.bin": BIG });
  await scan(context.storage);
  return context;
}

it("deletes only large files from archived, stopped, unpinned threads past the undo window", async () => {
  const { fixture, storage } = await largeFileScenario();

  const result = await storage.clearLargeFiles({ hostId: "host_a" });

  expect(result.clearedFiles).toBe(1);
  expect(result.clearedBytes).toBeGreaterThanOrEqual(BIG);
  expect(await fs.readdir(path.join(rootOf(fixture), uuid(1)))).toEqual(["small.txt"]);
  for (const n of [2, 3, 4, 5, 9])
    expect((await fs.readdir(path.join(rootOf(fixture), uuid(n)))).sort()).toEqual(
      n === 9 ? ["big.bin"] : ["big.bin", "small.txt"],
    );
  const { report } = await storage.host({ hostId: "host_a" });
  expect(report?.archivedLargeFiles).toEqual({ threadCount: 0, fileCount: 0, bytes: 0 });
  expect(report?.threadsWithStorageCount).toBe(5);
  // Nothing eligible is left, so another run does nothing and asks the machine nothing.
  const calls = fixture.hostCalls.length;
  await expect(storage.clearLargeFiles({ hostId: "host_a" })).resolves.toEqual({ clearedFiles: 0, clearedBytes: 0 });
  expect(fixture.hostCalls.length).toBe(calls);
});

it("keeps a folder in the report when the machine could not finish its large files", async () => {
  const { fixture, storage } = await largeFileScenario();
  fixture.intercept("discardLargeFiles", async (_call, forward) => {
    const result = (await forward()) as { removed: unknown[]; skipped: string[] };
    return { ...result, skipped: [uuid(1)] };
  });

  const result = await storage.clearLargeFiles({ hostId: "host_a" });

  // What was deleted is counted; the folder stays listed until a scan shows it is done.
  expect(result.clearedFiles).toBe(1);
  const { report } = await storage.host({ hostId: "host_a" });
  expect(report?.archivedLargeFiles.threadCount).toBe(1);
});

it("rechecks eligibility when the cleanup runs, not when the machine was scanned", async () => {
  const { fixture, storage } = await largeFileScenario();
  fixture.threads.set(uuid(1), { ...fixture.threads.get(uuid(1))!, pinnedAt: Date.now() });

  await expect(storage.clearLargeFiles({ hostId: "host_a" })).resolves.toEqual({ clearedFiles: 0, clearedBytes: 0 });

  expect(await fs.readdir(path.join(rootOf(fixture), uuid(1)))).toContain("big.bin");
});

it("clears large files on every scanned machine when none is named, and needs a scan for a named one", async () => {
  const { fixture, storage } = await setup({ machines: [{ id: "host_a" }, { id: "host_b" }, { id: "host_c" }] });
  const now = Date.now();
  for (const [n, hostId] of [[1, "host_a"], [2, "host_b"], [3, "host_c"]] as const) {
    fixture.addThread({ id: uuid(n), hostId, archivedAt: now - HOUR });
    await fixture.addEntry(uuid(n), { "big.bin": BIG }, hostId);
  }
  await scan(storage, "host_a");
  await scan(storage, "host_b");

  await expect(storage.clearLargeFiles({ hostId: "host_c" })).rejects.toThrow(
    "Scan the machine before clearing large files",
  );
  const result = await storage.clearLargeFiles({ hostId: null });

  expect(result.clearedFiles).toBe(2);
  expect(await fs.readdir(path.join(rootOf(fixture, "host_a"), uuid(1)))).toEqual([]);
  expect(await fs.readdir(path.join(rootOf(fixture, "host_b"), uuid(2)))).toEqual([]);
  expect(await fs.readdir(path.join(rootOf(fixture, "host_c"), uuid(3)))).toEqual(["big.bin"]);
});

it("runs the large-file cleanup in the background and reports the outcome", async () => {
  const { fixture, storage } = await largeFileScenario();
  const hold = gate();
  fixture.intercept("discardLargeFiles", async (_call, forward) => {
    await hold.promise;
    return forward();
  });

  await expect(storage.startClearLargeFiles({ hostId: "host_a" })).resolves.toBeNull();
  const running = await storage.host({ hostId: "host_a" });
  expect(running.largeFileCleanup).toMatchObject({ state: "running" });
  await expect(storage.startClearLargeFiles({ hostId: "host_a" })).rejects.toThrow("already running");
  hold.release();

  const done = await until(
    () => storage.host({ hostId: "host_a" }),
    (response) => response.largeFileCleanup.state !== "running",
  );
  expect(done.largeFileCleanup).toMatchObject({ state: "completed", clearedFiles: 1 });
});

it("reports a failed large-file cleanup and skips machines with nothing to clear", async () => {
  const { fixture, storage } = await largeFileScenario();
  fixture.intercept("discardLargeFiles", async () => {
    throw new Error("host disconnected");
  });

  await storage.startClearLargeFiles({ hostId: null });
  const failed = await until(
    () => storage.host({ hostId: "host_a" }),
    (response) => response.largeFileCleanup.state !== "running",
  );
  expect(failed.largeFileCleanup).toEqual({ state: "failed", message: "host disconnected" });

  fixture.clearInterceptors();
  await storage.clearLargeFiles({ hostId: "host_a" });
  const calls = fixture.hostCalls.length;
  await expect(storage.startClearLargeFiles({ hostId: null })).resolves.toBeNull();
  expect(fixture.hostCalls.length).toBe(calls);
  await expect(storage.startClearLargeFiles({ hostId: "host_missing" })).rejects.toThrow("Unknown machine");
});

// ---- archived threads' files -----------------------------------------------------------

async function archivedScenario() {
  const context = await setup();
  const { fixture } = context;
  const now = Date.now();
  fixture.addThread({ id: uuid(1), archivedAt: now - HOUR });
  fixture.addThread({ id: uuid(2), archivedAt: now - HOUR });
  fixture.addThread({ id: uuid(3), archivedAt: now - HOUR, pinnedAt: now - 2 * HOUR });
  fixture.addThread({ id: uuid(4), archivedAt: now - HOUR, status: "active" });
  fixture.addThread({ id: uuid(5), archivedAt: now - 1_000 });
  fixture.addThread({ id: uuid(6) });
  for (const n of [1, 2, 3, 4, 5, 6]) await fixture.addEntry(uuid(n), { "a.bin": 20_000 });
  await fixture.addEntry(uuid(9), { "a.bin": 20_000 });
  await fixture.addEntry(uuid(7), {});
  fixture.addThread({ id: uuid(7), archivedAt: now - HOUR });
  await scan(context.storage);
  return context;
}

it("clears the files of every archived, stopped, unpinned thread past the undo window, and only those", async () => {
  const { fixture, storage } = await archivedScenario();

  const result = await storage.clearArchivedFiles({ hostId: "host_a" });

  expect(result.clearedThreads).toBe(2);
  expect(result.clearedBytes).toBeGreaterThanOrEqual(40_000);
  for (const n of [1, 2]) expect(await fs.readdir(path.join(rootOf(fixture), uuid(n)))).toEqual([]);
  for (const n of [3, 4, 5, 6, 9])
    expect(await fs.readdir(path.join(rootOf(fixture), uuid(n)))).toEqual(["a.bin"]);
  const { report } = await storage.host({ hostId: "host_a" });
  expect(report?.archivedFiles).toEqual({ threadCount: 0, bytes: 0 });
  expect(report?.orphanCount).toBe(1);
});

it("needs a scan before clearing archived files, in the foreground or the background", async () => {
  const { storage } = await setup();
  await expect(storage.clearArchivedFiles({ hostId: "host_a" })).rejects.toThrow(
    "Scan the machine before clearing archived thread files",
  );
  await expect(storage.startClearArchivedFiles({ hostId: "host_a" })).rejects.toThrow(
    "Scan the machine before clearing archived thread files",
  );
});

it("clears archived files in the background and reports progress then the total", async () => {
  const { fixture, storage } = await archivedScenario();
  const hold = gate();
  fixture.intercept("discard", async (_call, forward) => {
    await hold.promise;
    return forward();
  });

  await expect(storage.startClearArchivedFiles({ hostId: "host_a" })).resolves.toBeNull();
  expect((await storage.host({ hostId: "host_a" })).archivedFileCleanup).toEqual({
    state: "running",
    clearedThreads: 0,
    clearedBytes: 0,
  });
  await expect(storage.startClearArchivedFiles({ hostId: "host_a" })).rejects.toThrow("already running");
  hold.release();

  const done = await until(
    () => storage.host({ hostId: "host_a" }),
    (response) => response.archivedFileCleanup.state !== "running",
  );
  expect(done.archivedFileCleanup).toMatchObject({ state: "completed", clearedThreads: 2 });
});

it.each(["failure", "unarchive", "pin", "active", "rearchive", "claimed"] as const)(
  "rechecks every batch of archived cleanup, so a thread that changed meanwhile (%s) is left alone",
  async (change) => {
    const { fixture, storage } = await setup();
    const now = Date.now();
    const ids = Array.from({ length: 101 }, (_, i) => uuid(i + 1));
    for (const id of ids) {
      fixture.addThread({ id, archivedAt: now - HOUR });
      await fixture.addEntry(id, { "a.bin": 1000 });
    }
    await scan(storage);
    const first = gate();
    const second = gate();
    let calls = 0;
    fixture.intercept("discard", async (_call, forward) => {
      calls += 1;
      if (calls === 1) {
        const result = await forward();
        first.release();
        await second.promise;
        return result;
      }
      if (change === "failure") throw new Error("host disconnected");
      return forward();
    });

    await storage.startClearArchivedFiles({ hostId: "host_a" });
    await first.promise;
    const target = ids[100]!;
    const thread = fixture.threads.get(target)!;
    if (change === "unarchive") fixture.threads.set(target, { ...thread, archivedAt: null });
    if (change === "pin") fixture.threads.set(target, { ...thread, pinnedAt: Date.now() });
    if (change === "active") fixture.threads.set(target, { ...thread, status: "active" });
    if (change === "rearchive") fixture.threads.set(target, { ...thread, archivedAt: Date.now() });
    if (change === "claimed") fixture.threads.delete(target);
    second.release();

    const done = await until(
      () => storage.host({ hostId: "host_a" }),
      (response) => response.archivedFileCleanup.state !== "running",
    );
    expect(await fs.readdir(path.join(rootOf(fixture), ids[0]!))).toEqual([]);
    if (change === "failure") {
      expect(done.archivedFileCleanup).toMatchObject({
        state: "failed",
        message: "host disconnected",
        clearedThreads: 100,
      });
      expect(await fs.readdir(path.join(rootOf(fixture), target))).toEqual(["a.bin"]);
    } else {
      expect(done.archivedFileCleanup).toMatchObject({ state: "completed", clearedThreads: 100 });
      expect(await fs.readdir(path.join(rootOf(fixture), target))).toEqual(["a.bin"]);
    }
  },
);

it("clears one archived thread only while it is still the archive it was queued for", async () => {
  const { fixture, storage } = await setup();
  const archivedAt = Date.now() - HOUR;
  fixture.addThread({ id: uuid(1), archivedAt });
  const directory = await fixture.addEntry(uuid(1), { "a.bin": 5_000 });

  await expect(storage.clearArchivedThread(uuid(1), archivedAt + 1)).resolves.toEqual({ outcome: "ineligible" });
  expect(await fs.readdir(directory)).toEqual(["a.bin"]);
  fixture.threads.set(uuid(1), { ...fixture.threads.get(uuid(1))!, pinnedAt: Date.now() });
  await expect(storage.clearArchivedThread(uuid(1), archivedAt)).resolves.toEqual({ outcome: "ineligible" });
  fixture.threads.set(uuid(1), { ...fixture.threads.get(uuid(1))!, pinnedAt: null });
  await expect(storage.clearArchivedThread(uuid(1), archivedAt)).resolves.toEqual({ outcome: "removed" });
  expect(await settled(async () => (await fs.readdir(directory)).length === 0)).toBe(true);
  await expect(storage.clearArchivedThread(uuid(1), archivedAt)).resolves.toEqual({ outcome: "empty" });
  expect(storage.clearedArchives().get(uuid(1))).toBe(archivedAt);
});

it("scans again after a cleanup without resurrecting what was cleared", async () => {
  const { fixture, storage } = await archivedScenario();
  await storage.clearArchivedFiles({ hostId: "host_a" });
  await waitForScan(storage);

  const rescan = await scan(storage);

  expect(rescan.report?.archivedFiles).toEqual({ threadCount: 0, bytes: 0 });
  expect(await listRoot(fixture)).toContain(uuid(1));
});
