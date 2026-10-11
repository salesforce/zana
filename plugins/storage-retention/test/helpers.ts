import { DatabaseSync } from "node:sqlite";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createFakePluginHost, type FakePluginHost } from "@zana-ai/zcc-plugin-sdk/testing";
import { experimental_createHostEntryHarness } from "@zana-ai/zcc-plugin-sdk/testing/host";
import type { PluginDatabase, PluginSdkThreadSummary } from "@zana-ai/zcc-plugin-sdk/server";
import hostEntry from "../host.js";

/** In-memory SQLite shaped like `zcc.storage.database()`. */
export function createTestDatabase(): PluginDatabase {
  const db = new DatabaseSync(":memory:");
  let applied = 0;
  return {
    runScript: (sql) => db.exec(sql),
    prepare: (sql) => {
      const statement = db.prepare(sql);
      return {
        all: (...params) => statement.all(...(params as never[])),
        get: (...params) => statement.get(...(params as never[])),
        run: (...params) => ({ changes: Number(statement.run(...(params as never[])).changes) }),
      };
    },
    // Like the host: statements are applied by position, once.
    migrate: (statements) => {
      for (let index = applied; index < statements.length; index++) db.exec(statements[index]!);
      applied = Math.max(applied, statements.length);
    },
    transaction: <T>(fn: () => T): T => {
      db.exec("BEGIN");
      try {
        const result = fn();
        db.exec("COMMIT");
        return result;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

/** Thread ids are UUIDs; this makes distinct, valid ones. */
export const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export function makeThread(
  overrides: Partial<PluginSdkThreadSummary> & { id: string },
): PluginSdkThreadSummary {
  return {
    projectId: "project_a",
    hostId: "host_a",
    environmentId: null,
    providerId: "codex",
    status: "idle",
    title: `Thread ${overrides.id.slice(-4)}`,
    visibility: "visible",
    originKind: null,
    parentThreadId: null,
    archivedAt: null,
    deletedAt: null,
    pinnedAt: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

export interface HostCall {
  hostId: string;
  method: string;
  input: unknown;
  signal?: AbortSignal;
}
export type Interceptor = (call: HostCall, forward: () => Promise<unknown>) => Promise<unknown>;

export interface FixtureMachine {
  id: string;
  name: string;
  online: boolean;
  /** The thread-storage root the machine's host module sees; null when the machine reports none. */
  root: string | null;
}

export interface Fixture {
  host: FakePluginHost;
  /** The plugin's database, for seeding rows the plugin itself would never write. */
  database: PluginDatabase;
  /** Mutable thread table the fake SDK serves. */
  threads: Map<string, PluginSdkThreadSummary>;
  machines: Map<string, FixtureMachine>;
  hostCalls: HostCall[];
  /** Number of `sdk.threads.list` pages served. */
  listingPages: () => number;
  /** Thread ids `sdk.threads.archive` archived, in order. */
  archived: string[];
  /** Runs when `sdk.threads.archive` is called, before it archives; may throw or change the world. */
  onArchive: ((threadId: string) => void | Promise<void>) | null;
  addThread(overrides: Partial<PluginSdkThreadSummary> & { id: string }): PluginSdkThreadSummary;
  /** Create a thread-storage folder (with files of the given sizes) on a machine. */
  addEntry(name: string, files?: Record<string, number>, hostId?: string): Promise<string>;
  intercept(method: string, hook: Interceptor): void;
  clearInterceptors(): void;
  tmp(): Promise<string>;
  dispose(): Promise<void>;
}

export interface FixtureOptions {
  machines?: Array<{ id: string; name?: string; root?: null }>;
}

const directories: string[] = [];

export async function tempDir(prefix = "zcc-storage-plugin-"): Promise<string> {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), prefix)));
  directories.push(dir);
  return dir;
}

export async function removeTempDirs(): Promise<void> {
  await Promise.all(
    directories.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
}

export async function createFixture(options: FixtureOptions = {}): Promise<Fixture> {
  const base = await tempDir();
  const threads = new Map<string, PluginSdkThreadSummary>();
  const machines = new Map<string, FixtureMachine>();
  const harnesses = new Map<string, ReturnType<typeof experimental_createHostEntryHarness>>();
  const interceptors = new Map<string, Interceptor>();
  const hostCalls: HostCall[] = [];
  const archived: string[] = [];
  let pages = 0;
  for (const spec of options.machines ?? [{ id: "host_a" }]) {
    const dataDir = path.join(base, spec.id);
    const root = spec.root === null ? null : path.join(dataDir, "thread-storage");
    await fs.mkdir(path.join(dataDir, "tmp"), { recursive: true });
    if (root !== null) await fs.mkdir(root, { recursive: true });
    machines.set(spec.id, { id: spec.id, name: spec.name ?? spec.id, online: true, root });
    harnesses.set(
      spec.id,
      experimental_createHostEntryHarness(hostEntry, {
        experimental_paths: { dataDir, tempDir: path.join(dataDir, "tmp"), threadStorageRoot: root },
      }),
    );
  }
  const database = createTestDatabase();
  const host = createFakePluginHost({
    pluginId: "storage-retention",
    database,
    getThread: async ({ threadId }) => threads.get(threadId) ?? null,
    listThreads: async (args) => {
      pages += 1;
      const rows = [...threads.values()]
        .filter((thread) => args.includeHidden === true || thread.visibility !== "hidden")
        .filter(
          (thread) => args.archived === undefined || (thread.archivedAt != null) === args.archived,
        )
        .sort((a, b) => (a.id < b.id ? -1 : 1));
      const offset = args.offset ?? 0;
      return rows.slice(offset, offset + (args.limit ?? 100));
    },
    archiveThread: async ({ threadId }) => {
      await fixture.onArchive?.(threadId);
      archived.push(threadId);
      const thread = threads.get(threadId);
      if (thread) threads.set(threadId, { ...thread, archivedAt: Date.now() });
      return { id: threadId };
    },
    experimental_callHostRpc: async (call) => {
      const machine = machines.get(call.hostId);
      const harness = harnesses.get(call.hostId);
      if (!machine || !harness || !machine.online) throw new Error(`Machine ${call.hostId} is offline`);
      const entry: HostCall = {
        hostId: call.hostId,
        method: call.method,
        input: call.input,
        signal: call.signal,
      };
      hostCalls.push(entry);
      const forward = () =>
        (harness.experimental_call as (method: string, input: unknown, options?: { signal?: AbortSignal }) => Promise<unknown>)(
          call.method,
          call.input,
          { signal: call.signal },
        );
      const hook = interceptors.get(call.method);
      return hook ? hook(entry, forward) : forward();
    },
  });
  host.harness.sdk.stub("hosts.list", async () =>
    [...machines.values()].map((machine) => ({ id: machine.id, name: machine.name })),
  );
  const fixture: Fixture = {
    host,
    database,
    threads,
    machines,
    hostCalls,
    archived,
    onArchive: null,
    listingPages: () => pages,
    addThread(overrides) {
      const thread = makeThread(overrides);
      threads.set(thread.id, thread);
      return thread;
    },
    async addEntry(name, files = { "data.bin": 4096 }, hostId = "host_a") {
      const root = machines.get(hostId)?.root;
      if (!root) throw new Error("machine has no thread-storage root");
      const directory = path.join(root, name);
      await fs.mkdir(directory, { recursive: true });
      for (const [file, size] of Object.entries(files)) {
        const target = path.join(directory, file);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, Buffer.alloc(size, 1));
      }
      return directory;
    },
    intercept: (method, hook) => void interceptors.set(method, hook),
    clearInterceptors: () => interceptors.clear(),
    tmp: () => tempDir(),
    async dispose() {
      await host.harness.dispose();
      for (const harness of harnesses.values()) await harness.experimental_dispose();
    },
  };
  return fixture;
}

/** Folder names directly under a machine's thread-storage root. */
export async function listRoot(fixture: Fixture, hostId = "host_a"): Promise<string[]> {
  const root = fixture.machines.get(hostId)?.root;
  return root ? (await fs.readdir(root)).sort() : [];
}

/** A promise settled from outside, for holding a host call open. */
export function gate<T = void>() {
  let release!: (value: T) => void;
  let fail!: (error: Error) => void;
  const promise = new Promise<T>((resolve, reject) => {
    release = resolve;
    fail = reject;
  });
  return { promise, release, fail };
}

/** Make a folder look like it was last modified `ageMs` ago. */
/** Backdate a folder and everything in it, children first so the parents keep the old time. */
export async function age(directory: string, ageMs: number): Promise<void> {
  const when = new Date(Date.now() - ageMs);
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const child = path.join(directory, entry.name);
    if (entry.isDirectory()) await age(child, ageMs);
    else await fs.lutimes(child, when, when);
  }
  await fs.utimes(directory, when, when);
}

/** Wait until a condition holds (background deletes finish shortly after their call). */
export async function settled(check: () => Promise<boolean>, attempts = 300): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return check();
}
