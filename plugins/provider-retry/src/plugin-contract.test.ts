import { describe, expect, it } from "vitest";
import { collectTestPluginApp } from "@zana-ai/zcc-plugin-sdk/testing/app";
import { createFakePluginHost } from "@zana-ai/zcc-plugin-sdk/testing";
import app from "../app.js";
import plugin from "../server.js";
import { classifyProviderRetry } from "./recovery.js";
import { ProviderRetryService } from "./service.js";

describe("provider-retry plugin", () => {
  it("registers a composer banner and retry action", () => {
    const set = collectTestPluginApp(app, "provider-retry");
    expect(set.composerCustomizations[0]?.banners?.[0]?.id).toBe(
      "subscription-recovery",
    );
    expect(set.composerCustomizations[0]?.actions?.[0]?.id).toBe("retry-last");
  });

  it("schedules an automatic retry after a failed subscription-window turn", async () => {
    const events = [
      {
        seq: 1,
        type: "client/turn/requested",
        payload: {
          requestId: "creq_1",
          execution: { model: "default", permissionMode: "full" },
        },
      },
      {
        seq: 2,
        type: "turn/input/accepted",
        payload: {
          clientRequestId: "creq_1",
          scope: { kind: "turn", turnId: "turn-1" },
        },
      },
      {
        seq: 3,
        type: "provider/error",
        payload: {
          scope: { kind: "turn", turnId: "turn-1" },
          errorInfo: { category: "rate-limit" },
          willRetry: false,
        },
      },
      {
        seq: 4,
        type: "turn/completed",
        payload: { status: "failed", scope: { kind: "turn", turnId: "turn-1" } },
      },
      {
        seq: 5,
        type: "provider/rateLimits/updated",
        payload: {
          rateLimits: {
            providerId: "codex",
            status: "blocked",
            kind: "subscription-window",
            windows: [{ status: "blocked", resetsAtMs: Date.now() + 60_000 }],
          },
        },
      },
    ];
    const { zcc, harness } = createFakePluginHost({
      getThread: async () => ({
        id: "thr-1",
        projectId: "p1",
        hostId: "host-1",
        environmentId: "env-1",
        providerId: "codex",
        status: "error",
      }),
      listThreadEvents: async () => events,
      sendThread: async () => ({ id: "thr-1" }),
    });
    const service = new ProviderRetryService(
      zcc,
      { now: () => Date.now(), random: () => 0 },
      6 * 60 * 60 * 1_000,
    );
    await service.reconcile("thr-1");
    const view = service.status("thr-1");
    expect(view?.providerId).toBe("codex");
    expect(view?.retryAtMs).toBeGreaterThan(Date.now());
    expect(
      classifyProviderRetry({ events, hostId: "host-1", providerId: "codex" }).reason,
    ).toBe("eligible");
    expect(await service.cancel("thr-1")).toBe(true);
    expect(service.status("thr-1")).toBeNull();
    service.dispose();
    await harness.dispose();
  });

  it("loads the server factory onto a fake host", async () => {
    const { zcc, harness } = createFakePluginHost();
    await plugin(zcc);
    expect(harness.events.some((entry) => entry.name === "thread.failed")).toBe(
      true,
    );
    await harness.dispose();
  });
});
