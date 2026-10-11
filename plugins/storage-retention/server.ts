import type { PluginRpcHandlers } from "@zana-ai/zcc-plugin-sdk";
import type { ZccPluginApi } from "@zana-ai/zcc-plugin-sdk/server";
import { registerCli } from "./src/cli.js";
import { storageRpc } from "./src/contract.js";
import { createService } from "./src/service.js";
import { toStorageThread } from "./src/sdk-data.js";
import { createStorage } from "./src/storage.js";

export default function plugin(zcc: ZccPluginApi) {
  const storage = createStorage(zcc);
  const service = createService(zcc, storage);
  const cleanupEnabled = async () => (await service.state()).policy.clearStorageOnArchive;

  // A thread archived while "clear on archive" is on is queued, then cleared
  // once its undo window passes. An unarchive or a new archive of the same
  // thread is noticed when the entry is next looked at, not through an event.
  zcc.events.on("thread.archived", async (event) => {
    const found = event.thread ?? (await zcc.sdk.threads.get({ threadId: event.threadId }));
    if (!found) return;
    const thread = toStorageThread(found);
    if (thread.archivedAt === null || thread.pinnedAt !== null || !(await cleanupEnabled())) return;
    storage.queueArchivedStorage(thread.id, thread.archivedAt);
    await storage.clearPendingArchives(cleanupEnabled);
  });
  for (const name of ["thread.idle", "thread.failed"] as const)
    zcc.events.on(name, () => storage.clearPendingArchives(cleanupEnabled));
  zcc.background.schedule("archive-storage-cleanup", "* * * * *", () =>
    storage.clearPendingArchives(cleanupEnabled),
  );
  zcc.background.schedule("retention", "0 * * * *", () => service.sweep());

  const handlers: PluginRpcHandlers<typeof storageRpc> = {
    hosts: () => storage.hosts(),
    host: (input) => storage.host(input),
    scanHost: (input) => storage.scanHost(input),
    scanAll: () => storage.scanAll(),
    startRemoveOrphans: (input) => storage.startRemoveOrphans(input),
    removeOrphans: (input) => storage.removeOrphans(input),
    startClearLargeFiles: (input) => storage.startClearLargeFiles(input),
    clearLargeFiles: (input) => storage.clearLargeFiles(input),
    clearThread: (input) => storage.clearThread(input),
    startClearArchivedFiles: (input) => storage.startClearArchivedFiles(input),
    clearArchivedFiles: (input) => storage.clearArchivedFiles(input),
    state: () => service.state(),
    preview: (input) => service.preview(input),
    configure: (input) => service.configure(input),
  };
  // The host does not check inputs or outputs against the contract, so this
  // plugin does: every request is parsed, and only the documented fields leave.
  zcc.rpc.register(
    storageRpc,
    Object.fromEntries(
      (Object.keys(handlers) as Array<keyof typeof storageRpc>).map((name) => [
        name,
        async (raw: unknown) => {
          const input = storageRpc[name].input.safeParse(raw);
          if (!input.success) throw new Error(`Invalid input for ${name}`);
          const handler = handlers[name] as (value: unknown) => unknown;
          return storageRpc[name].output.parse(await handler(input.data));
        },
      ]),
    ),
  );
  registerCli(zcc, service, storage);
}
