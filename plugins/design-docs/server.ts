import type { ZccPluginApi } from '@zana-ai/zcc-plugin-sdk/server';
import { CHANGED_CHANNEL } from './src/shared/contract.js';
import { createLocalFileReader, registerDesignDocCli } from './src/server/cli.js';
import { registerAgentContext } from './src/server/context.js';
import { registerRpc } from './src/server/rpc.js';
import { DesignDocStore } from './src/server/store.js';
import { createActorResolver, registerDesignDocTools } from './src/server/tools.js';

export default function plugin(zcc: ZccPluginApi): void {
  const store = new DesignDocStore(zcc.storage.database());
  const changed = (docId: string) => zcc.realtime.publish(CHANGED_CHANNEL, { docId });
  const actorFor = createActorResolver((threadId) => zcc.sdk.threads.get({ threadId }));

  registerDesignDocTools(zcc, { store, changed, actorFor });
  registerAgentContext(zcc, store, (message) => zcc.log.warn(message));
  registerDesignDocCli(zcc, { store, changed, actorFor, readLocalFile: createLocalFileReader(zcc.sdk) });
  registerRpc(zcc, { store, changed, sdk: zcc.sdk });

  // Keep the "Agents" list on each doc accurate as linked threads evolve.
  zcc.events.on('thread.idle', (event) => {
    for (const docId of store.touchThread(event.threadId, event.thread?.title ?? null)) changed(docId);
  });
  zcc.events.on('thread.deleted', (event) => {
    for (const docId of store.forgetThread(event.threadId)) changed(docId);
  });

  zcc.log.info('design docs ready');
}
