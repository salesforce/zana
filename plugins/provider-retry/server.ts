import type { ZccPluginApi } from "@zana-ai/zcc-plugin-sdk/server";
import { registerProviderRetryCli } from "./src/cli.js";
import { providerRetryRpcMethods } from "./src/contract.js";
import {
  DEFAULT_MAXIMUM_WAIT_MS,
  ProviderRetryService,
} from "./src/service.js";

const MAXIMUM_WAIT_OPTIONS = ["6 hours", "24 hours", "No limit"] as const;

function maximumWaitMs(value: string | boolean | undefined): number | null {
  switch (value) {
    case "6 hours":
      return DEFAULT_MAXIMUM_WAIT_MS;
    case "24 hours":
      return 24 * 60 * 60 * 1_000;
    case "No limit":
      return null;
    default:
      throw new Error(
        `Unsupported maximum provider retry wait: ${String(value)}`,
      );
  }
}

export default async function plugin(zcc: ZccPluginApi): Promise<void> {
  const settings = zcc.settings.define({
    maximumWait: {
      type: "select",
      label: "Maximum automatic wait",
      description:
        "Do not schedule a retry when the reported reset is farther away than this.",
      options: [...MAXIMUM_WAIT_OPTIONS],
      default: "6 hours",
    },
  });
  const initialSettings = await settings.get();
  const service = new ProviderRetryService(
    zcc,
    undefined,
    maximumWaitMs(initialSettings.maximumWait),
  );
  settings.onChange((next) => {
    service.setMaximumWaitMs(maximumWaitMs(next.maximumWait));
  });
  zcc.onDispose(() => service.dispose());

  zcc.rpc.register(
    {
      methods: Object.values(providerRetryRpcMethods),
    },
    {
      async providerRetryCancel(args) {
        const threadId =
          typeof args === "object" &&
          args !== null &&
          "threadId" in args &&
          typeof args.threadId === "string"
            ? args.threadId
            : "";
        return { cancelled: await service.cancel(threadId) };
      },
      providerRetryStatus(args) {
        const threadId =
          typeof args === "object" &&
          args !== null &&
          "threadId" in args &&
          typeof args.threadId === "string"
            ? args.threadId
            : "";
        return { view: service.status(threadId) };
      },
    },
  );
  registerProviderRetryCli(zcc, service);

  zcc.events.on("thread.failed", async ({ threadId }) => {
    try {
      await service.reconcile(threadId);
    } catch (error) {
      zcc.log.warn(
        `Could not inspect provider retry for ${threadId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
  zcc.events.on("thread.archived", ({ threadId }) => service.supersede(threadId));
  zcc.events.on("thread.deleted", ({ threadId }) => service.deleteThread(threadId));
}
