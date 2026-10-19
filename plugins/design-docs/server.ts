import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ZccPluginApi } from '@zana-ai/zcc-plugin-sdk/server';
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
  // Constructing the document store applies append-only migrations before sync state is read.
  const store = new DesignDocStore(zcc.storage.database(), {
    onMutation: (mutation) => {
      syncStore.recordLocalMutation(mutation);
      peerSync?.mutationCommitted();
    }
  });
  syncStore = new DesignDocSyncStore(zcc.storage.database());
  const sdkPeers = zcc.sdk.peers;
  const backups = new DesignDocBackups(zcc.storage.database(), syncStore, {
    kv: zcc.storage.kv,
    backup: typeof zcc.storage.backupDatabase === 'function' ? (options) => zcc.storage.backupDatabase(options) : undefined,
    // Core-held and outside this plugin's folder, so a folder restore cannot roll it back.
    epochs: typeof sdkPeers?.storageEpoch === 'function' && typeof sdkPeers.advanceStorageEpoch === 'function'
      ? { current: () => sdkPeers.storageEpoch!(), advance: (expected) => sdkPeers.advanceStorageEpoch!(expected) }
      : undefined
  });
  let localPeerId: () => string | null = () => null;
  let pairing: DesignDocPairing | undefined;
  if (['handle', 'list', 'call', 'localIdentity', 'enrolled', 'features', 'enable', 'revoke', 'introduce']
    .every((method) => typeof zcc.sdk.peers?.[method as keyof typeof zcc.sdk.peers] === 'function')) {
    peerSync = new DesignDocPeerService(syncStore, (docId) => zcc.realtime.publish(CHANGED_CHANNEL, { docId }));
    peerSync.initialize();
    const group = new DesignDocPeerGroup(zcc.storage.database());
    localPeerId = () => group.localPeerId();
    const peers = zcc.sdk.peers;
    pairing = new DesignDocPairing(group, peers, {
      // Opaque, convergence-stable digest (ids + file content, not per-replica heads); peers compare it without exchanging content.
      stateDigest: createStateDigest(store, syncStore),
      stateChanged: () => zcc.realtime.publish(PEER_STATE_CHANNEL, {}),
      connectionsChanged: () => zcc.realtime.publish(PEER_STATE_CHANNEL, {})
    });
    let disposed = false, stopFence = () => {};
    zcc.onDispose(() => { disposed = true; stopFence(); });
    // A copied or restored database must not answer peers or deliver until its writer identity is verified. Fail closed.
    void peers.localIdentity().then(async ({ id }) => {
      const restore = await backups.verifyRestore(group, id);
      if (restore.restored) zcc.log.warn(`design docs database was restored or copied (${restore.reason}); peer sync detached as a new replica, rejoin required`);
      if (backups.fenceStatus() === 'degraded') zcc.log.warn('design docs restore fence degraded: host storage epoch unavailable; only plugin-folder evidence is checked');
      if (disposed) return;
      stopFence = backups.maintainFence((error) => zcc.log.warn(`design docs restore fence lost: ${error instanceof Error ? error.message : 'unknown error'}; restart to re-verify`));
      peerSync!.register(zcc);
      peerSync!.start(peers);
      pairing!.register(zcc);
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
