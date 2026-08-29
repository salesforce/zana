import { describe, expect, it } from "vitest";
import { classifyProviderRetry } from "./recovery.js";
import type { PluginSdkThreadEventRow } from "@zana-ai/zcc-plugin-sdk/server";

function row(
  seq: number,
  type: string,
  payload: Record<string, unknown>,
): PluginSdkThreadEventRow {
  return { seq, type, payload };
}

const request = row(1, "client/turn/requested", {
  requestId: "creq_1",
  execution: { model: "default", permissionMode: "full" },
});
const accepted = row(2, "turn/input/accepted", {
  clientRequestId: "creq_1",
  scope: { kind: "turn", turnId: "turn-1" },
});
const rateLimitError = row(3, "provider/error", {
  scope: { kind: "turn", turnId: "turn-1" },
  errorInfo: { category: "rate-limit" },
  willRetry: false,
});
const completed = row(4, "turn/completed", {
  status: "failed",
  scope: { kind: "turn", turnId: "turn-1" },
});
const rateLimits = row(5, "provider/rateLimits/updated", {
  rateLimits: {
    providerId: "codex",
    status: "blocked",
    kind: "subscription-window",
    windows: [{ status: "blocked", resetsAtMs: 1_700_000_000_000 }],
  },
});

describe("classifyProviderRetry", () => {
  it("marks a subscription-window rate limit as eligible", () => {
    const inspection = classifyProviderRetry({
      events: [request, accepted, rateLimitError, completed, rateLimits],
      hostId: "host-1",
      providerId: "codex",
    });
    expect(inspection.reason).toBe("eligible");
    expect(inspection.candidate).toMatchObject({
      automatic: true,
      failedRequestId: "creq_1",
      turnId: "turn-1",
      resetsAtMs: 1_700_000_000_000,
    });
  });

  it("returns manual-only when the window reset is unknown", () => {
    const inspection = classifyProviderRetry({
      events: [request, accepted, rateLimitError, completed],
      hostId: "host-1",
      providerId: "codex",
    });
    expect(inspection.reason).toBe("manual-only");
    expect(inspection.candidate?.automatic).toBe(false);
  });

  it("ignores a rate-limit error the provider will retry itself", () => {
    const inspection = classifyProviderRetry({
      events: [
        request,
        accepted,
        row(3, "provider/error", {
          scope: { kind: "turn", turnId: "turn-1" },
          errorInfo: { category: "rate-limit" },
          willRetry: true,
        }),
        completed,
      ],
      hostId: "host-1",
      providerId: "codex",
    });
    expect(inspection.reason).toBe("provider-will-retry");
    expect(inspection.candidate).toBeNull();
  });

  it("treats a later manual stop as superseded", () => {
    const inspection = classifyProviderRetry({
      events: [
        request,
        accepted,
        rateLimitError,
        completed,
        row(6, "system/thread/interrupted", { reason: "manual-stop" }),
      ],
      hostId: "host-1",
      providerId: "codex",
    });
    expect(inspection.reason).toBe("superseded");
  });
});
