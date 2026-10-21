import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PluginDatabase, ZccPluginApi } from '@zana-ai/zcc-plugin-sdk/server';
import { CHANGED_CHANNEL, PEER_STATE_CHANNEL } from './src/shared/contract.js';
import { createCliCaller, createLocalFileReader, createLocalFileWriter, registerDesignDocCli } from './src/server/cli.js';
import { registerAgentContext } from './src/server/context.js';
import {
  createKitReader,
  createPageRoutes,
  createRuntimeSource,
  pluginHttpEndpoint,
  productServerUrl,
  standalonePageUrl
} from './src/server/pages.js';
import { registerPanelThreadLinks } from './src/server/panel-threads.js';
import { RenderReports } from './src/server/render-reports.js';
import { registerRpc } from './src/server/rpc.js';
import { createProjectNames } from './src/server/project-names.js';
import { DesignDocStore } from './src/server/store.js';
import { createActorResolver, registerDesignDocTools } from './src/server/tools.js';
import { DesignDocSyncStore } from './src/server/sync-store.js';
import { DesignDocPeerService } from './src/server/peer-service.js';
import { DesignDocPeerGroup } from './src/server/peer-group.js';
import { DesignDocPairing } from './src/server/pairing.js';
import { createStateDigest } from './src/server/state-digest.js';
import { DesignDocBackups } from './src/server/backup.js';

/** The plugin folder: `server.ts` (path installs) and the built `server.mjs` both sit at its root. */
const PLUGIN_ROOT = dirname(fileURLToPath(import.meta.url));


export default function plugin(zcc: ZccPluginApi): void {
  let syncStore!: DesignDocSyncStore;
  let peerSync: DesignDocPeerService | undefined;
  const database = zcc.storage.database();
  let checkFence = () => {};
  let observeFence = () => {};
  let verified = false;
  let expectedEpoch: number | null = null;
  let depth = 0;
  // Check at SQL boundaries, not on a timer: rollback must be caught before allocating or sending a sequence.
  const guarded: PluginDatabase = {
    migrate: (statements) => database.migrate(statements),
    runScript: (sql) => { checkFence(); database.runScript(sql); if (!depth) observeFence(); },
    prepare: (sql) => {
      const statement = database.prepare(sql);
      return {
        get: (...args) => { checkFence(); return statement.get(...args); },
        all: (...args) => { checkFence(); return statement.all(...args); },
        run: (...args) => { checkFence(); const result = statement.run(...args); if (!depth) observeFence(); return result; }
      };
    },
    transaction: (fn) => {
      checkFence();
      depth++;
      try {
        const result = database.transaction(fn);
        if (depth === 1) observeFence();
        return result;
      } finally { depth--; }
    }
  };
  // Constructing the document store applies append-only migrations before sync state is read.
  const store = new DesignDocStore(guarded, {
    onMutation: (mutation) => {
      syncStore.recordLocalMutation(mutation);
      peerSync?.mutationCommitted();
    }
  });
  syncStore = new DesignDocSyncStore(guarded);
  const sdkPeers = zcc.sdk.peers;
  const fenceDatabase: PluginDatabase = {
    ...database,
    prepare: (sql) => {
      const statement = database.prepare(sql);
      return {
        get: (...args) => statement.get(...args),
        all: (...args) => statement.all(...args),
        run: (...args) => { if (verified) checkFence(); return statement.run(...args); }
      };
    }
  };
  const backups = new DesignDocBackups(fenceDatabase, new DesignDocSyncStore(database), {
    kv: zcc.storage.kv,
    backup: typeof zcc.storage.backupDatabase === 'function' ? (options) => zcc.storage.backupDatabase(options) : undefined,
    // Core-held and outside this plugin's folder, so a folder restore cannot roll it back.
    epochs: typeof sdkPeers?.storageEpoch === 'function' && typeof sdkPeers.advanceStorageEpoch === 'function'
      ? { current: () => sdkPeers.storageEpoch!(), advance: async (expected) => {
        const next = await sdkPeers.advanceStorageEpoch!(expected);
        expectedEpoch = next;
        return next;
      } }
      : undefined
  });
  let localPeerId: () => string | null = () => null;
  let pairing: DesignDocPairing | undefined;
  if (['handle', 'list', 'call', 'localIdentity', 'enrolled', 'features', 'enable', 'revoke', 'introduce']
    .every((method) => typeof zcc.sdk.peers?.[method as keyof typeof zcc.sdk.peers] === 'function')) {
    peerSync = new DesignDocPeerService(syncStore, (docId) => zcc.realtime.publish(CHANGED_CHANNEL, { docId }));
    peerSync.initialize();
    const group = new DesignDocPeerGroup(guarded);
    let peerActive = false;
    // Local document CRUD stays open during the async identity/verification window; fail-closed applies to
    // answering and delivering to peers (deferred register/start + peerActive), not to local writes. The fence
    // arms into a rollback detector only after a bound verification, and throws once it is lost.
    localPeerId = () => peerActive ? group.localPeerId() : null;
    const peers = zcc.sdk.peers;
    pairing = new DesignDocPairing(group, peers, {
      // Opaque, convergence-stable digest (ids + file content, not per-replica heads); peers compare it without exchanging content.
      stateDigest: createStateDigest(store, syncStore),
      stateChanged: () => zcc.realtime.publish(PEER_STATE_CHANNEL, {}),
      connectionsChanged: () => zcc.realtime.publish(PEER_STATE_CHANNEL, {})
    });
    let disposed = false, stopFence = () => {};
    let lost: Error | undefined;
    const cleanups: Array<() => void | Promise<void>> = [];
    const peerApi = { ...zcc, onDispose: (hook: () => void | Promise<void>) => { cleanups.push(hook); zcc.onDispose(hook); } };
    const loseFence = (error: unknown) => {
      if (lost || disposed) return;
      lost = new Error(`design docs restore fence lost: ${error instanceof Error ? error.message : 'unknown error'}; restart to re-verify`);
      stopFence();
      for (const cleanup of cleanups.splice(0).reverse()) void cleanup();
      zcc.log.warn(lost.message);
      zcc.realtime.publish(PEER_STATE_CHANNEL, {});
    };
    zcc.onDispose(() => { disposed = true; stopFence(); });
    // A copied or restored database must not answer peers or deliver until its writer identity is verified. Fail closed.
    void peers.localIdentity().then(async ({ id }) => {
      const restore = await backups.verifyRestore(new DesignDocPeerGroup(database), id);
      if (restore.restored) zcc.log.warn(`design docs database was restored or copied (${restore.reason}); peer sync detached as a new replica, rejoin required`);
      if (disposed) return;
      // No host storage epoch: the strong rollback fence can't arm. Degrade to plugin-folder evidence only
      // (HEAD behavior) rather than disabling sync, so hosts whose peers SDK predates storage epochs keep working.
      if (backups.fenceStatus() !== 'bound') {
        zcc.log.warn('design docs restore fence degraded: host storage epoch unavailable; only plugin-folder evidence is checked');
        checkFence = () => {};
        peerActive = true;
        stopFence = backups.maintainFence(loseFence);
        peerSync!.register(peerApi);
        peerSync!.start(peers);
        pairing!.register(peerApi);
        return;
      }
      const generation = database.prepare('SELECT generation FROM dd_replica_generation WHERE singleton = 1').get() as { generation: string };
      const frontier = () => database.prepare(`SELECT r.replica_id, COALESCE(MAX(o.sequence), 0) AS top FROM sync_repositories r
        LEFT JOIN sync_operations o ON o.repo_id = r.repo_id AND o.replica_id = r.replica_id GROUP BY r.repo_id ORDER BY r.created_at LIMIT 1`)
        .get() as { replica_id: string; top: number };
      let observed = frontier();
      checkFence = () => {
        if (lost) throw lost;
        if (depth) return;
        try {
          const current = frontier();
          const next = database.prepare('SELECT generation FROM dd_replica_generation WHERE singleton = 1').get() as { generation: string } | undefined;
          const writer = database.prepare('SELECT app_id, epoch, pending FROM dd_writer_fence WHERE singleton = 1').get() as
            { app_id: string; epoch: number; pending: number | null } | undefined;
          if (next?.generation !== generation.generation || writer?.app_id !== id ||
            (writer.epoch !== expectedEpoch && writer.pending !== expectedEpoch) ||
            current?.replica_id !== observed.replica_id || current.top < observed.top) {
            throw new Error('database rollback detected');
          }
        } catch (error) { loseFence(error); throw lost ?? error; }
      };
      observeFence = () => { observed = frontier(); };
      verified = true;
      peerActive = true;
      stopFence = backups.maintainFence(loseFence);
      peerSync!.register(peerApi);
      peerSync!.start(peers);
      pairing!.register(peerApi);
    }).catch((error: unknown) => zcc.log.warn(`design docs peer sync disabled: ${error instanceof Error ? error.message : 'identity unavailable'}`));
  } else {
    zcc.log.warn('design docs peer setup unavailable: host SDK peers are not installed');
  }
  const kit = createKitReader(join(PLUGIN_ROOT, 'kit'));
  const endpoint = pluginHttpEndpoint(zcc.pluginId);
  const changed = (docId: string) => zcc.realtime.publish(CHANGED_CHANNEL, { docId });
  const actorFor = createActorResolver((threadId) => zcc.sdk.threads.get({ threadId }));
  const projects = createProjectNames(() => zcc.sdk.projects.list());
  const reports = new RenderReports();

  registerDesignDocTools(zcc, { store, changed, actorFor, projects, kit, reports });
  registerAgentContext(zcc, store, (message) => zcc.log.warn(message), projects);
  registerPanelThreadLinks(zcc, store, changed);
  const pageUrl = (docId: string, path: string) => standalonePageUrl(productServerUrl(), endpoint, docId, path);
  registerDesignDocCli(zcc, {
    store,
    changed,
    projects,
    caller: createCliCaller(zcc.sdk, actorFor),
    readLocalFile: createLocalFileReader(zcc.sdk),
    writeLocalFile: createLocalFileWriter(zcc.sdk),
    pageUrl,
    kit,
    reports,
    pairing,
    peerSync,
    peers: zcc.sdk.peers
  });
  registerRpc(zcc, { store, changed, sdk: zcc.sdk, peerSync, pairing, kit, pageUrl, reports, backups, localPeerId: () => localPeerId() });

  // Standalone pages: the doc as its published site, for any browser on this machine.
  const pages = createPageRoutes({
    store,
    kit,
    endpoint,
    runtime: createRuntimeSource(join(PLUGIN_ROOT, 'page-runtime.js'), (message) => zcc.log.warn(message))
  });
  zcc.http.route('GET', '/page', pages.page);
  zcc.http.route('GET', '/file', pages.file);

  // Keep the "Agents" list on each doc accurate as linked threads evolve.
  zcc.events.on('thread.idle', (event) => {
    for (const docId of store.touchThread(event.threadId, event.thread?.title ?? null)) changed(docId);
  });
  zcc.events.on('thread.deleted', async (event) => {
    // The host sends this on archive too; keep threads that can be unarchived.
    const thread = await zcc.sdk.threads.get({ threadId: event.threadId }).catch(() => null);
    if (thread && !thread.deletedAt) return;
    for (const docId of store.forgetThread(event.threadId)) changed(docId);
  });

  zcc.log.info('design docs ready');
}
