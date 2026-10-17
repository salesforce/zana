import fs from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vitest";
import plugin from "../server.js";
import { age, uuid, type Fixture } from "../test/helpers.js";
import { HOUR, until, useStorageFixtures } from "../test/storage-helpers.js";
import { LARGE_FILE_MIN_BYTES } from "./rules.js";

const setup = useStorageFixtures();
const BIG = LARGE_FILE_MIN_BYTES + 4096;
const DAY = 24 * HOUR;

async function cliSetup(options?: Parameters<typeof setup>[0]) {
  const context = await setup(options);
  await plugin(context.fixture.host.zcc);
  const run = async (...argv: string[]) => {
    const result = await context.fixture.host.harness.runCli(argv);
    return {
      exitCode: result.exitCode,
      stderr: result.stderr,
      json: result.stdout.trim() ? JSON.parse(result.stdout) : null,
      stdout: result.stdout,
    };
  };
  return { ...context, run };
}
const rootOf = (fixture: Fixture, hostId = "host_a") => fixture.machines.get(hostId)!.root!;
const files = (fixture: Fixture, id: string) => fs.readdir(path.join(rootOf(fixture), id));

it("lists its commands for no command, help and --help, and exits 2 for an unknown one", async () => {
  const { fixture, run } = await cliSetup();
  const names = ["usage", "retention", "remove-orphans", "clear-large-files", "clear-archived-files", "clear-thread"];

  for (const argv of [[], ["help"], ["--help"]]) {
    const result = await fixture.host.harness.runCli(argv);
    expect(result.exitCode).toBe(0);
    for (const name of names) expect(result.stdout).toContain(`zcc storage ${name}`);
  }
  expect(fixture.host.harness.cli?.commands?.map((command) => command.name)).toEqual(names);
  const unknown = await fixture.host.harness.runCli(["frobnicate"]);
  expect(unknown.exitCode).toBe(2);
  expect(unknown.stderr).toContain("Unknown command frobnicate");
  const specific = await fixture.host.harness.runCli(["clear-thread", "--help"]);
  expect(specific.exitCode).toBe(0);
  expect(specific.stdout).toContain("zcc storage clear-thread --thread <id> --yes");
});

it.each([
  [["usage", "--bogus"], "Unknown option --bogus"],
  [["usage", "extra"], "Unexpected argument extra"],
  [["usage", "--machine"], "Option --machine needs a value"],
  [["usage", "--machine", "--rescan"], "Option --machine needs a value"],
  [["usage", "--machine=a", "--machine=b"], "Option --machine was given twice"],
  [["usage", "--rescan=true"], "Option --rescan takes no value"],
  [["usage", "--toString"], "Unknown option --toString"],
])("rejects %j as a usage error without running anything", async (argv, message) => {
  const { fixture, run } = await cliSetup();

  const result = await run(...argv);

  expect(result.exitCode).toBe(2);
  expect(result.stderr).toContain(message);
  expect(result.stderr).toContain("Usage: zcc storage usage");
  expect(fixture.hostCalls).toEqual([]);
});

it("reads cached usage for every machine or one, and rescans on request", async () => {
  const { fixture, run } = await cliSetup({ machines: [{ id: "host_a" }, { id: "host_b" }] });
  fixture.addThread({ id: uuid(1) });
  await fixture.addEntry(uuid(1), { "a.bin": 10_000 });

  const all = await run("usage");
  expect(all.exitCode).toBe(0);
  expect(all.json.hosts.map((host: { hostId: string }) => host.hostId)).toEqual(["host_a", "host_b"]);
  expect(all.json.hosts[0].report).toBeNull();

  const started = await run("usage", "--machine=host_a", "--rescan");
  expect(started.json.scan.state).toBe("scanning");
  const done = await until(
    async () => (await run("usage", "--machine", "host_a")).json,
    (host) => host.scan.state !== "scanning",
  );
  expect(done.report.threadsWithStorageCount).toBe(1);

  const rescanAll = await run("usage", "--rescan");
  expect(rescanAll.json.hosts).toHaveLength(2);
  expect((await run("usage", "--machine", "nowhere")).stderr).toContain("Unknown machine");
  expect((await run("usage", "--machine", "nowhere")).exitCode).toBe(1);
});

it("shows the policy, previews thresholds, and saves only with --save --yes", async () => {
  const { fixture, run } = await cliSetup();
  fixture.addThread({ id: uuid(1), updatedAt: Date.now() - 100 * DAY });

  const initial = await run("retention");
  expect(initial.json).toEqual({
    policy: { archiveAfterDays: null, clearAfterDays: null, clearStorageOnArchive: false },
    lastRun: null,
  });

  const previewed = await run("retention", "--archive-after", "30", "--clear-on-archive", "true");
  expect(previewed.json).toEqual({
    policy: { archiveAfterDays: 30, clearAfterDays: null, clearStorageOnArchive: true },
    preview: { archiveCount: 1, clearCount: 0 },
  });
  expect((await run("retention")).json.policy.archiveAfterDays).toBeNull();

  const unconfirmed = await run("retention", "--archive-after", "30", "--save");
  expect(unconfirmed.exitCode).toBe(1);
  expect(unconfirmed.stderr).toContain("--save --yes");
  expect((await run("retention")).json.policy.archiveAfterDays).toBeNull();

  const saved = await run("retention", "--archive-after", "30", "--clear-after", "90", "--save", "--yes");
  expect(saved.json.policy).toEqual({ archiveAfterDays: 30, clearAfterDays: 90, clearStorageOnArchive: false });
  // Settings not named keep their value; never switches one off again.
  const adjusted = await run("retention", "--archive-after", "never", "--save", "--yes");
  expect(adjusted.json.policy).toEqual({ archiveAfterDays: null, clearAfterDays: 90, clearStorageOnArchive: false });
});

it.each([
  [["--archive-after", "0"], "Days must be a whole number from 1 to 3650"],
  [["--clear-after", "5000"], "Days must be a whole number from 1 to 3650"],
  [["--archive-after", "soon"], "Use a number of days"],
  [["--archive-after", "1.5"], "Use a number of days"],
  [["--archive-after", "-3"], "Use a number of days"],
  [["--clear-on-archive", "yes"], "Use true or false for --clear-on-archive"],
])("refuses retention settings %j", async (flags, message) => {
  const { run } = await cliSetup();

  const result = await run("retention", ...flags);

  expect(result.exitCode === 1 || result.exitCode === 2).toBe(true);
  expect(result.stderr).toContain(message);
  expect((await run("retention")).json.policy.archiveAfterDays).toBeNull();
});

it.each([
  [["remove-orphans", "--machine", "host_a"], "orphaned"],
  [["clear-large-files"], "large files"],
  [["clear-archived-files", "--machine", "host_a"], "archived thread files"],
  [["clear-thread", "--thread", uuid(1)], "thread storage"],
])("%j deletes nothing without --yes", async (argv, what) => {
  const { fixture, run } = await cliSetup();
  const now = Date.now();
  fixture.addThread({ id: uuid(1), archivedAt: now - HOUR });
  await fixture.addEntry(uuid(1), { "big.bin": BIG });
  await fixture.addEntry(uuid(9), { "a.bin": 1000 });
  await age(path.join(rootOf(fixture), uuid(9)), HOUR);
  await run("usage", "--machine", "host_a", "--rescan");
  await until(async () => (await run("usage", "--machine", "host_a")).json, (host) => host.scan.state !== "scanning");

  const result = await run(...argv);

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("Pass --yes");
  expect(result.stderr).toContain(what);
  expect(await files(fixture, uuid(1))).toEqual(["big.bin"]);
  expect(await files(fixture, uuid(9))).toEqual(["a.bin"]);
});

it("removes orphaned storage after a scan, in the foreground or the background", async () => {
  const { fixture, run } = await cliSetup();
  fixture.addThread({ id: uuid(1) });
  await fixture.addEntry(uuid(1), { "a.bin": 1000 });
  for (const n of [8, 9]) {
    await fixture.addEntry(uuid(n), { "a.bin": 1000 });
    await age(path.join(rootOf(fixture), uuid(n)), HOUR);
  }
  expect((await run("remove-orphans", "--yes")).stderr).toContain("Provide --machine.");
  expect((await run("remove-orphans", "--machine", "host_a", "--yes")).stderr).toContain("Scan the machine");
  await run("usage", "--machine", "host_a", "--rescan");
  await until(async () => (await run("usage", "--machine", "host_a")).json, (host) => host.scan.state !== "scanning");

  const foreground = await run("remove-orphans", "--machine", "host_a", "--yes");
  expect(foreground.exitCode).toBe(0);
  expect(foreground.json.removedCount).toBe(2);

  await fixture.addEntry(uuid(7), { "a.bin": 1000 });
  await age(path.join(rootOf(fixture), uuid(7)), HOUR);
  await run("usage", "--machine", "host_a", "--rescan");
  await until(async () => (await run("usage", "--machine", "host_a")).json, (host) => host.scan.state !== "scanning");
  const background = await run("remove-orphans", "--machine", "host_a", "--yes", "--background");
  expect(background.json).toEqual({ started: true });
  const done = await until(
    async () => (await run("usage", "--machine", "host_a")).json,
    (host) => host.maintenance.state !== "running",
  );
  expect(done.maintenance.state).toBe("completed");
  // Trash directories are purged just after the maintenance state flips to completed.
  const remaining = await until(
    async () => fs.readdir(rootOf(fixture)),
    (names) => !names.some((name) => name.startsWith(".zcc-trash-")),
  );
  expect(remaining).toEqual([uuid(1)]);
});

it("clears large files and archived files, and one thread, when asked with --yes", async () => {
  const { fixture, run } = await cliSetup();
  const archivedAt = Date.now() - HOUR;
  fixture.addThread({ id: uuid(1), archivedAt });
  fixture.addThread({ id: uuid(2), archivedAt });
  fixture.addThread({ id: uuid(3) });
  for (const n of [1, 2, 3]) await fixture.addEntry(uuid(n), { "big.bin": BIG, "small.txt": 10 });
  await run("usage", "--machine", "host_a", "--rescan");
  await until(async () => (await run("usage", "--machine", "host_a")).json, (host) => host.scan.state !== "scanning");

  const large = await run("clear-large-files", "--yes");
  expect(large.json.clearedFiles).toBe(2);
  expect(await files(fixture, uuid(1))).toEqual(["small.txt"]);
  expect(await files(fixture, uuid(3))).toContain("big.bin");

  const thread = await run("clear-thread", "--thread", uuid(3), "--yes");
  expect(thread.json).toEqual({ ok: true });
  expect(await files(fixture, uuid(3))).toEqual([]);
  expect((await run("clear-thread", "--yes")).stderr).toContain("Provide --thread.");
  expect((await run("clear-thread", "--thread", "nope", "--yes")).stderr).toContain("Thread not found");

  const archived = await run("clear-archived-files", "--machine", "host_a", "--yes");
  expect(archived.json.clearedThreads).toBe(2);
  expect(await files(fixture, uuid(2))).toEqual([]);
  expect((await run("clear-archived-files", "--yes")).stderr).toContain("Provide --machine.");
});

it("starts the large-file and archived-file cleanups in the background with --background", async () => {
  const { fixture, run } = await cliSetup();
  fixture.addThread({ id: uuid(1), archivedAt: Date.now() - HOUR });
  await fixture.addEntry(uuid(1), { "big.bin": BIG });
  await run("usage", "--machine", "host_a", "--rescan");
  await until(async () => (await run("usage", "--machine", "host_a")).json, (host) => host.scan.state !== "scanning");

  expect((await run("clear-large-files", "--machine", "host_a", "--yes", "--background")).json).toEqual({
    started: true,
  });
  const large = await until(
    async () => (await run("usage", "--machine", "host_a")).json,
    (host) => host.largeFileCleanup.state !== "running",
  );
  expect(large.largeFileCleanup).toMatchObject({ state: "completed", clearedFiles: 1 });

  expect((await run("clear-archived-files", "--machine", "host_a", "--yes", "--background")).json).toEqual({
    started: true,
  });
  const archived = await until(
    async () => (await run("usage", "--machine", "host_a")).json,
    (host) => host.archivedFileCleanup.state !== "running",
  );
  expect(archived.archivedFileCleanup.state).toBe("completed");
});
