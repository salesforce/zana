import { migrateLegacyTasks } from './migration';
import type { ZccPluginApi } from '@zana-ai/zcc-plugin-sdk';
import { defineRpcContract, adaptPluginApi } from "./compat/server";
import { z } from "zod";

import { createStore, registerTasksApi } from "./api";
import { registerAttachments } from "./attachments";
import { registerTasksCli } from "./cli";
import { registerDelegation } from "./delegate";
import { registerLifecycle } from "./lifecycle";
import { registerMentions } from "./mentions";

const TASKS_PLUGIN_NAME = "Tasks";
export const TASKS_PLUGIN_VERSION = "0.2.0";

const tasksRpcContract = defineRpcContract({
  ping: {
    input: z.null(),
    output: z.object({ ok: z.literal(true), version: z.string() }),
  },
});

function statusPayload() {
  return { name: TASKS_PLUGIN_NAME, version: TASKS_PLUGIN_VERSION };
}

export default async function plugin(zcc: ZccPluginApi) {
  const bb = adaptPluginApi(zcc);
  bb.log.info(`${TASKS_PLUGIN_NAME} ${TASKS_PLUGIN_VERSION} loaded`);

  const store = createStore(bb);
  await migrateLegacyTasks(zcc, bb, store);
  zcc.rpc.method("executionCatalog", async (args) => {
    const { providerId, hostId } = (args ?? {}) as { providerId?: string; hostId?: string };
    return { providers: await bb.sdk.providers.list(), ...(providerId ? { catalog: await zcc.sdk.providers.models({ providerId, hostId }) } : {}) };
  });
  registerTasksApi(bb, store);
  registerAttachments(bb, store.tasks);
  registerTasksCli(bb, store, statusPayload());
  registerDelegation(bb, store);
  registerMentions(bb, store);
  await registerLifecycle(bb, store);

  bb.rpc.register(tasksRpcContract, {
    ping(): { ok: true; version: string } {
      return { ok: true, version: TASKS_PLUGIN_VERSION };
    },
  });
}
