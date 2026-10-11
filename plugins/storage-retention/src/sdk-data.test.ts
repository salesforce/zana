import { describe, expect, it, vi } from "vitest";
import type { PluginSdkThreadSummary, ZccPluginApi } from "@zana-ai/zcc-plugin-sdk";
import { makeThread, uuid } from "../test/helpers.js";
import { THREAD_READ_CAP } from "./rules.js";
import { isLive, readThreads, toStorageThread } from "./sdk-data.js";

const apiWith = (list: (args: { includeHidden?: boolean; limit?: number; offset?: number }) => Promise<PluginSdkThreadSummary[]>) =>
  ({ sdk: { threads: { list: vi.fn(list) } } }) as unknown as ZccPluginApi;

describe("toStorageThread", () => {
  it("settles missing fields conservatively", () => {
    const row = makeThread({ id: uuid(1) });
    delete (row as { pinnedAt?: unknown }).pinnedAt;
    delete (row as { updatedAt?: unknown }).updatedAt;
    delete (row as { title?: unknown }).title;
    const thread = toStorageThread({ ...row, titleFallback: "Fallback" });
    // Unknown pin state counts as pinned; unknown activity counts as just now.
    expect(thread.pinnedAt).not.toBeNull();
    expect(thread.updatedAt).toBe(Number.MAX_SAFE_INTEGER);
    expect(thread.title).toBe("Fallback");
  });

  it("falls back to the id for a title, and to visible, no origin and no parent", () => {
    const row = makeThread({ id: uuid(2) });
    delete (row as { title?: unknown }).title;
    delete (row as { visibility?: unknown }).visibility;
    delete (row as { originKind?: unknown }).originKind;
    delete (row as { parentThreadId?: unknown }).parentThreadId;
    delete (row as { archivedAt?: unknown }).archivedAt;
    delete (row as { deletedAt?: unknown }).deletedAt;
    expect(toStorageThread(row)).toMatchObject({
      title: uuid(2),
      visibility: "visible",
      originKind: null,
      parentThreadId: null,
      archivedAt: null,
      deletedAt: null,
    });
  });

  it("keeps known values", () => {
    const thread = toStorageThread(
      makeThread({ id: uuid(3), pinnedAt: null, updatedAt: 55, archivedAt: 9, parentThreadId: uuid(4), originKind: "fork" }),
    );
    expect(thread).toMatchObject({ pinnedAt: null, updatedAt: 55, archivedAt: 9, parentThreadId: uuid(4), originKind: "fork" });
  });
});

it("knows which statuses may still be using a thread's storage", () => {
  expect(["starting", "active", "stopping"].every((status) => isLive({ status }))).toBe(true);
  expect(["idle", "error"].some((status) => isLive({ status }))).toBe(false);
});

describe("readThreads", () => {
  it("reads every page, hidden threads included", async () => {
    const rows = Array.from({ length: 1201 }, (_, i) => makeThread({ id: uuid(i + 1) }));
    const zcc = apiWith(async ({ offset = 0, limit = 500 }) => rows.slice(offset, offset + limit));
    const threads = await readThreads(zcc);
    expect(threads).toHaveLength(1201);
    expect(zcc.sdk.threads.list).toHaveBeenCalledTimes(3);
    expect(vi.mocked(zcc.sdk.threads.list).mock.calls.every(([args]) => args?.includeHidden === true)).toBe(true);
  });

  it("reads an exact page boundary and an empty table", async () => {
    const rows = Array.from({ length: 500 }, (_, i) => makeThread({ id: uuid(i + 1) }));
    const zcc = apiWith(async ({ offset = 0, limit = 500 }) => rows.slice(offset, offset + limit));
    expect(await readThreads(zcc)).toHaveLength(500);
    expect(await readThreads(apiWith(async () => []))).toEqual([]);
  });

  it("stops when aborted", async () => {
    const controller = new AbortController();
    const zcc = apiWith(async () => {
      controller.abort(new Error("stopped"));
      return Array.from({ length: 500 }, (_, i) => makeThread({ id: uuid(i + 1) }));
    });
    await expect(readThreads(zcc, controller.signal)).rejects.toThrow("stopped");
  });

  it("fails closed instead of acting on a partial view of an oversized table", async () => {
    const page = Array.from({ length: 500 }, (_, i) => makeThread({ id: uuid(i + 1) }));
    const zcc = apiWith(async () => page);
    await expect(readThreads(zcc)).rejects.toThrow(`Too many threads (over ${THREAD_READ_CAP})`);
  });
});
