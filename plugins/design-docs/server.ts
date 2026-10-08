import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ZccPluginApi } from '@zana-ai/zcc-plugin-sdk/server';
import { CHANGED_CHANNEL } from './src/shared/contract.js';
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
import { RenderReports } from './src/server/render-reports.js';
import { registerRpc } from './src/server/rpc.js';
import { createProjectNames } from './src/server/project-names.js';
import { DesignDocStore } from './src/server/store.js';
import { createActorResolver, registerDesignDocTools } from './src/server/tools.js';

/** The plugin folder: `server.ts` (path installs) and the built `server.mjs` both sit at its root. */
const PLUGIN_ROOT = dirname(fileURLToPath(import.meta.url));

export default function plugin(zcc: ZccPluginApi): void {
  const store = new DesignDocStore(zcc.storage.database());
  const kit = createKitReader(join(PLUGIN_ROOT, 'kit'));
  const endpoint = pluginHttpEndpoint(zcc.pluginId);
  const changed = (docId: string) => zcc.realtime.publish(CHANGED_CHANNEL, { docId });
  const actorFor = createActorResolver((threadId) => zcc.sdk.threads.get({ threadId }));
  const projects = createProjectNames(() => zcc.sdk.projects.list());
  const reports = new RenderReports();

  registerDesignDocTools(zcc, { store, changed, actorFor, projects, kit, reports });
  registerAgentContext(zcc, store, (message) => zcc.log.warn(message), projects);
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
    reports
  });
  registerRpc(zcc, { store, changed, sdk: zcc.sdk, kit, pageUrl, reports });

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
