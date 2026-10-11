import fs from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vitest";
import { gate, listRoot, uuid } from "../test/helpers.js";
import {
  HOUR,
  scan,
  trashName as trashEntry,
  useStorageFixtures,
  waitForScan,
} from "../test/storage-helpers.js";
import { LARGE_FILE_MIN_BYTES } from "./rules.js";
import { createStorage } from "./storage.js";

const setup = useStorageFixtures();
const trashName = (n: number, m: number) => trashEntry(uuid(n), uuid(m));

it("scans a machine and reports its thread storage by category", async () => {
  const { fixture, storage } = await setup();
  const now = Date.now();
  fixture.addThread({ id: uuid(1), title: "Active work" });
  fixture.addThread({ id: uuid(2), archivedAt: now - HOUR });
  fixture.addThread({ id: uuid(3), visibility: "hidden" });
  fixture.addThread({ id: uuid(4), visibility: "hidden", archivedAt: now - HOUR });
  fixture.addThread({ id: uuid(5), status: "active" });
  fixture.addThread({ id: uuid(6), archivedAt: now - 1_000 });
  fixture.addThread({ id: uuid(7), archivedAt: now - HOUR, pinnedAt: now - 2 * HOUR });
  fixture.addThread({ id: uuid(8) });
  await fixture.addEntry(uuid(1), { "a.bin": 200_000 });
  await fixture.addEntry(uuid(2), { "a.bin": 150_000 });
  await fixture.addEntry(uuid(3), { "a.bin": 50_000 });
  await fixture.addEntry(uuid(4), { "a.bin": 60_000 });
  await fixture.addEntry(uuid(5), { "a.bin": 40_000 });
  await fixture.addEntry(uuid(6), { "a.bin": 8_000 });
  await fixture.addEntry(uuid(7), { "a.bin": 9_000 });
  await fixture.addEntry(uuid(900), { "a.bin": 30_000 });
  await fixture.addEntry(trashName(901, 902), { "a.bin": 20_000 });
  await fixture.addEntry("model-list", { "a.bin": 500_000 });

  const response = await scan(storage);

  expect(response.scan).toEqual({ state: "idle" });
  const report = response.report!;
  expect(report.hostId).toBe("host_a");
  expect(Math.abs(report.scannedAt - Date.now())).toBeLessThan(60_000);
  expect(report.disk?.totalBytes).toBeGreaterThan(0);
  expect(report.threadsWithStorageCount).toBe(7);
  expect(report.archivedThreadCount).toBe(4);
  expect(report.orphanCount).toBe(2);
  expect(report.partialCount).toBe(0);
  expect(report.activeThreadBytes).toBeGreaterThanOrEqual(200_000 + 50_000 + 40_000);
  expect(report.activeThreadBytes).toBeLessThan(200_000 + 50_000 + 40_000 + 65_536);
  expect(report.archivedThreadBytes).toBeGreaterThanOrEqual(150_000 + 60_000 + 8_000 + 9_000);
  expect(report.orphanBytes).toBeGreaterThanOrEqual(50_000);
  expect(report.orphanBytes).toBeLessThan(500_000);
  expect(report.hiddenThreads).toMatchObject({ activeCount: 1, archivedCount: 1 });
  expect(report.hiddenThreads.activeBytes).toBeGreaterThanOrEqual(50_000);
  expect(report.hiddenThreads.archivedBytes).toBeGreaterThanOrEqual(60_000);
  // Only archived, unpinned threads past the undo grace can have files cleared.
  expect(report.archivedFiles.threadCount).toBe(2);
  expect(report.archivedFiles.bytes).toBeGreaterThanOrEqual(150_000 + 60_000);
  expect(report.archivedLargeFiles).toEqual({ threadCount: 0, fileCount: 0, bytes: 0 });
  expect(report.largestThreads.map((thread) => thread.threadId)).toEqual([
    uuid(1),
    uuid(2),
    uuid(4),
    uuid(3),
    uuid(5),
    uuid(7),
    uuid(6),
  ]);
  expect(report.largestThreads[0]).toMatchObject({
    threadId: uuid(1),
    projectId: "project_a",
    title: "Active work",
    archivedAt: null,
    running: false,
    hidden: false,
    pinned: false,
  });
  expect(report.largestThreads.find((thread) => thread.threadId === uuid(5))?.running).toBe(true);
  expect(report.largestThreads.find((thread) => thread.threadId === uuid(7))?.pinned).toBe(true);
  expect(report.largestThreads.find((thread) => thread.threadId === uuid(3))?.hidden).toBe(true);
  // The scan only ever read folders it recognised: the daemon's own folders are not storage.
  expect(await listRoot(fixture)).toContain("model-list");
  expect(
    fixture.hostCalls.filter((call) => call.method === "measureEntries").flatMap((call) => (call.input as { names: string[] }).names),
  ).not.toContain("model-list");
});

it("sizes large files of archived threads for the large-file cleanup", async () => {
  const { fixture, storage } = await setup();
  const now = Date.now();
  fixture.addThread({ id: uuid(1), archivedAt: now - HOUR });
  fixture.addThread({ id: uuid(2), archivedAt: now - HOUR, pinnedAt: now - 2 * HOUR });
  fixture.addThread({ id: uuid(3) });
  const big = LARGE_FILE_MIN_BYTES + 4096;
  await fixture.addEntry(uuid(1), { "big.bin": big, "small.bin": 1000 });
  await fixture.addEntry(uuid(2), { "big.bin": big });
  await fixture.addEntry(uuid(3), { "big.bin": big });

  const { report } = await scan(storage);

  expect(report!.archivedLargeFiles.threadCount).toBe(1);
  expect(report!.archivedLargeFiles.fileCount).toBe(1);
  expect(report!.archivedLargeFiles.bytes).toBeGreaterThanOrEqual(big);
});

it("keeps the previous report visible while rescanning and replaces it when the scan completes", async () => {
  const { fixture, storage } = await setup();
  fixture.addThread({ id: uuid(1) });
  await fixture.addEntry(uuid(1), { "a.bin": 10_000 });
  const first = await scan(storage);
  expect(first.report?.threadsWithStorageCount).toBe(1);

  fixture.addThread({ id: uuid(2) });
  await fixture.addEntry(uuid(2), { "a.bin": 10_000 });
  const hold = gate();
  fixture.intercept("measureEntries", async (_call, forward) => {
    const result = await forward();
    await hold.promise;
    return result;
  });
  const started = await storage.scanHost({ hostId: "host_a" });
  expect(started.scan.state).toBe("scanning");
  expect(started.report?.threadsWithStorageCount).toBe(1);
  // A second request while one runs reuses the running scan.
  const layoutsBefore = fixture.hostCalls.filter((call) => call.method === "layout").length;
  const again = await storage.scanHost({ hostId: "host_a" });
  expect(again.scan.state).toBe("scanning");
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(fixture.hostCalls.filter((call) => call.method === "layout")).toHaveLength(layoutsBefore);

  hold.release();
  const done = await waitForScan(storage);
  expect(done.scan).toEqual({ state: "idle" });
  expect(done.report?.threadsWithStorageCount).toBe(2);
});

it("fails a scan visibly so it can be retried", async () => {
  const { fixture, storage } = await setup();
  fixture.addThread({ id: uuid(1) });
  await fixture.addEntry(uuid(1));
  fixture.intercept("layout", async () => {
    throw new Error("disk unreadable");
  });

  const failed = await scan(storage);

  expect(failed.scan).toMatchObject({ state: "failed", message: "disk unreadable" });
  expect(failed.report).toBeNull();
  expect(fixture.host.harness.published.some((event) => event.event === "changed")).toBe(true);

  fixture.clearInterceptors();
  const retried = await scan(storage);
  expect(retried.scan).toEqual({ state: "idle" });
  expect(retried.report?.threadsWithStorageCount).toBe(1);
});

it("fails a scan when the machine reports no thread-storage root", async () => {
  const { storage } = await setup({ machines: [{ id: "host_a", root: null }] });

  const response = await scan(storage);

  expect(response.scan).toMatchObject({
    state: "failed",
    message: "This machine did not report a thread-storage root",
  });
});

it("fails a scan when the machine is offline and reports an unknown machine at once", async () => {
  const { fixture, storage } = await setup();
  fixture.machines.get("host_a")!.online = false;

  expect((await scan(storage)).scan).toMatchObject({ state: "failed", message: "Machine host_a is offline" });
  await expect(storage.scanHost({ hostId: "host_missing" })).rejects.toThrow("Unknown machine");
  await expect(storage.host({ hostId: "host_missing" })).rejects.toThrow("Unknown machine");
});

it("walks past a measurement budget by asking again for the folders the machine skipped", async () => {
  const { fixture, storage } = await setup();
  for (let i = 1; i <= 6; i++) {
    fixture.addThread({ id: uuid(i) });
    await fixture.addEntry(uuid(i), { "a.bin": 5_000 });
  }
  let first = true;
  fixture.intercept("measureEntries", async (call, forward) => {
    if (!first) return forward();
    first = false;
    const names = (call.input as { names: string[] }).names;
    const result = (await forward()) as { entries: unknown[]; skipped: string[]; missing: string[] };
    return { ...result, entries: result.entries.slice(0, 2), skipped: names.slice(2) };
  });

  const response = await scan(storage);

  expect(response.report?.threadsWithStorageCount).toBe(6);
  expect(fixture.hostCalls.filter((call) => call.method === "measureEntries").length).toBeGreaterThan(1);
});

it("fails a scan whose machine stops making progress", async () => {
  const { fixture, storage } = await setup();
  fixture.addThread({ id: uuid(1) });
  await fixture.addEntry(uuid(1));
  fixture.intercept("measureEntries", async (call) => ({
    entries: [],
    missing: [],
    skipped: (call.input as { names: string[] }).names,
  }));

  expect((await scan(storage)).scan).toMatchObject({
    state: "failed",
    message: expect.stringContaining("no progress"),
  });
});

it("counts folders whose size is only a lower bound and drops folders that vanished", async () => {
  const { fixture, storage } = await setup();
  fixture.addThread({ id: uuid(1) });
  fixture.addThread({ id: uuid(2) });
  await fixture.addEntry(uuid(1));
  await fixture.addEntry(uuid(2));
  await fixture.addEntry(uuid(3));
  fixture.intercept("measureEntries", async (call, forward) => {
    const result = (await forward()) as {
      entries: Array<{ name: string; partial: boolean }>;
      skipped: string[];
      missing: string[];
    };
    return {
      ...result,
      entries: result.entries
        .filter((entry) => entry.name !== uuid(3))
        .map((entry) => (entry.name === uuid(2) ? { ...entry, partial: true } : entry)),
      missing: [uuid(3)],
    };
  });

  const { report } = await scan(storage);

  expect(report?.partialCount).toBe(1);
  expect(report?.threadsWithStorageCount).toBe(2);
  expect(report?.orphanCount).toBe(0);
});

it("lists every machine with its own state and builds all reports from one thread listing", async () => {
  const { fixture, storage } = await setup({
    machines: [
      { id: "host_a", name: "Laptop" },
      { id: "host_b", name: "Server" },
      { id: "host_c", name: "Spare" },
    ],
  });
  fixture.addThread({ id: uuid(1), hostId: "host_a" });
  fixture.addThread({ id: uuid(2), hostId: "host_b" });
  await fixture.addEntry(uuid(1), { "a.bin": 10_000 }, "host_a");
  await fixture.addEntry(uuid(2), { "a.bin": 10_000 }, "host_b");
  await scan(storage, "host_a");
  await scan(storage, "host_b");

  const pagesBefore = fixture.listingPages();
  const { hosts } = await storage.hosts();

  expect(fixture.listingPages() - pagesBefore).toBe(1);
  expect(hosts.map((machine) => [machine.hostId, machine.hostName])).toEqual([
    ["host_a", "Laptop"],
    ["host_b", "Server"],
    ["host_c", "Spare"],
  ]);
  expect(hosts[0]!.report?.threadsWithStorageCount).toBe(1);
  expect(hosts[1]!.report?.threadsWithStorageCount).toBe(1);
  expect(hosts[2]).toMatchObject({
    report: null,
    scan: { state: "idle" },
    maintenance: { state: "idle" },
    largeFileCleanup: { state: "idle" },
    archivedFileCleanup: { state: "idle" },
  });
});

it("scans every machine and lets an offline one fail on its own", async () => {
  const { fixture, storage } = await setup({
    machines: [{ id: "host_a" }, { id: "host_b" }],
  });
  fixture.addThread({ id: uuid(1), hostId: "host_a" });
  await fixture.addEntry(uuid(1), { "a.bin": 10_000 }, "host_a");
  fixture.machines.get("host_b")!.online = false;

  await storage.scanAll();
  const a = await waitForScan(storage, "host_a");
  const b = await waitForScan(storage, "host_b");

  expect(a.report?.threadsWithStorageCount).toBe(1);
  expect(b.scan).toMatchObject({ state: "failed" });
  expect(b.report).toBeNull();
});

it("keeps cleanup available during a scan and leaves cleared storage out of its result", async () => {
  const { fixture, storage } = await setup();
  const now = Date.now();
  fixture.addThread({ id: uuid(1) });
  fixture.addThread({ id: uuid(2), archivedAt: now - HOUR });
  await fixture.addEntry(uuid(1), { "a.bin": 20_000 });
  await fixture.addEntry(uuid(2), { "a.bin": 20_000 });
  await scan(storage);

  // The rescan measures the folders, then waits: storage cleared meanwhile must stay out of it.
  const hold = gate();
  fixture.intercept("measureEntries", async (_call, forward) => {
    const result = await forward();
    await hold.promise;
    return result;
  });
  const started = await storage.scanHost({ hostId: "host_a" });
  expect(started.scan.state).toBe("scanning");
  await new Promise((resolve) => setTimeout(resolve, 20));

  await storage.clearThread({ threadId: uuid(2) });
  const during = await storage.host({ hostId: "host_a" });
  expect(during.scan.state).toBe("scanning");
  expect(during.report?.threadsWithStorageCount).toBe(1);

  hold.release();
  const finished = await waitForScan(storage);
  expect(finished.scan).toEqual({ state: "idle" });
  expect(finished.report?.threadsWithStorageCount).toBe(1);
  expect(finished.report?.largestThreads.map((thread) => thread.threadId)).toEqual([uuid(1)]);
  expect((await fs.readdir(path.join(fixture.machines.get("host_a")!.root!, uuid(2))))).toEqual([]);

  // The next scan sees the emptied folder again, with nothing left in it.
  fixture.clearInterceptors();
  const next = await scan(storage);
  expect(next.report?.threadsWithStorageCount).toBe(2);
  expect(next.report?.archivedFiles.bytes).toBe(0);
});

it("stops in-flight work when the plugin is disposed and publishes nothing afterwards", async () => {
  const { fixture, storage } = await setup();
  fixture.addThread({ id: uuid(1) });
  await fixture.addEntry(uuid(1));
  const reached = gate();
  fixture.intercept("layout", (call) => {
    reached.release();
    return new Promise((_resolve, reject) =>
      call.signal?.addEventListener("abort", () => reject(call.signal?.reason ?? new Error("aborted")), { once: true }),
    );
  });
  await storage.scanHost({ hostId: "host_a" });
  await reached.promise;
  const published = fixture.host.harness.published.length;

  await fixture.host.harness.lifecycle.dispose();

  expect(fixture.host.harness.published).toHaveLength(published);
  await expect(storage.host({ hostId: "host_a" })).rejects.toThrow();
});

it("discards a cached report it cannot read and shows the machine as never scanned", async () => {
  const { fixture, storage } = await setup();
  fixture.addThread({ id: uuid(1) });
  await fixture.addEntry(uuid(1), { "a.bin": 10_000 });
  await scan(storage);
  fixture.database.prepare("UPDATE scans SET result_json = ?").run("{not json");

  expect((await storage.host({ hostId: "host_a" })).report).toBeNull();
  // The unreadable row is gone, so a rescan starts clean.
  expect(fixture.database.prepare("SELECT COUNT(*) AS n FROM scans").get()).toEqual({ n: 0 });
  expect((await scan(storage)).report?.threadsWithStorageCount).toBe(1);
});

it("scans through the isolated worker's async host client without sending a contract", async () => {
  const { fixture } = await setup();
  fixture.addThread({ id: uuid(1) });
  await fixture.addEntry(uuid(1), { "a.bin": 12_000 });
  const zcc = fixture.host.zcc;
  const requested: unknown[] = [];
  // The worker bridge turns every `zcc.host.*` member into an async call.
  const storage = createStorage({
    ...zcc,
    host: {
      ...zcc.host,
      experimental_client: ((...args: unknown[]) => {
        requested.push(args);
        return Promise.resolve(zcc.host.experimental_client());
      }) as unknown as typeof zcc.host.experimental_client,
    },
  });

  const response = await scan(storage);

  expect(requested).toEqual([[]]);
  expect(response.scan.state).toBe("idle");
  expect(response.report?.activeThreadBytes).toBeGreaterThanOrEqual(12_000);
});
