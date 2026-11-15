import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, upsertHost } from "@zana-ai/zcc-db";
import { createPluginApi } from "./plugin-api.js";
import { getThreadProvider } from "../services/threads/thread-provider-catalog.js";
import type { ProductHttpContext } from "../http/product-context.js";
vi.mock("../services/threads/thread-provider-catalog.js", async (original) => ({
  ...(await original<object>()),
  getThreadProvider: vi.fn(),
}));
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.mocked(getThreadProvider).mockReset();
});
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "plugin-usage-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const db = openDatabase(join(dir, "runtime.sqlite"));
  cleanups.push(() => db.close());
  const host = upsertHost(db, { name: "Local", hostKeyHash: "local" });
  const handle = createPluginApi("optional", dir, {
    productContext: { db } as ProductHttpContext,
  });
  cleanups.push(() => handle.dispose());
  return { handle, host, dir };
}
it("routes usage through the declared provider only for registered execution hosts", async () => {
  const { handle, host } = fixture();
  const usage = vi.fn(async () => ({
    supported: true as const,
    usage: { status: "unauthenticated" as const },
  }));
  vi.mocked(getThreadProvider).mockReturnValue({ usage } as never);
  await expect(
    handle.api.sdk.providers.usage({ providerId: "test", hostId: "foreign" }),
  ).rejects.toThrow(/Unknown/);
  expect(usage).not.toHaveBeenCalled();
  await expect(
    handle.api.sdk.providers.usage({ providerId: "test", hostId: host.id }),
  ).resolves.toEqual({ supported: true, usage: { status: "unauthenticated" } });
  expect(usage).toHaveBeenCalledWith(host.id);
  vi.mocked(getThreadProvider).mockReturnValue(undefined as never);
  await expect(
    handle.api.sdk.providers.usage({ providerId: "missing", hostId: host.id }),
  ).resolves.toEqual({ supported: false });
});

it("rejects missing runtime context and disposed plugin callbacks", async () => {
  const { handle, host, dir } = fixture();
  const noContext = createPluginApi("usage-no-context", join(dir, "no-context"));
  cleanups.push(() => noContext.dispose());
  await expect(noContext.api.sdk.providers.usage({ providerId: "test", hostId: host.id })).rejects.toThrow("zcc.sdk is not available");
  await handle.dispose();
  await expect(handle.api.sdk.providers.usage({ providerId: "test", hostId: host.id })).rejects.toThrow();
});

it("treats unavailable providers and absent callbacks as unsupported and preserves provider failures", async () => {
  const { handle, host } = fixture();
  const usage = vi.fn(async () => ({ supported: false as const }));
  for (const provider of [{}, { unavailableReason: "Bridge unavailable", usage }]) {
    vi.mocked(getThreadProvider).mockReturnValue(provider as never);
    await expect(handle.api.sdk.providers.usage({ providerId: "test", hostId: host.id })).resolves.toEqual({ supported: false });
  }
  expect(usage).not.toHaveBeenCalled();
  vi.mocked(getThreadProvider).mockReturnValue({ usage: async () => { throw new Error("Host unavailable"); } } as never);
  await expect(handle.api.sdk.providers.usage({ providerId: "test", hostId: host.id })).rejects.toThrow("Host unavailable");
});
