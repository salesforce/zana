import { describe, expect, it } from "vitest";
import {
  setThreadNotificationLevelRequestSchema,
  threadNotificationVerdictQuerySchema,
} from "../src/api/notifications.js";
import { createPublicApiClient } from "../src/public-api.js";

describe("thread notification contract", () => {
  it("accepts only the four own levels and no extra keys", () => {
    for (const level of ["inherit", "all", "input-only", "muted"]) {
      expect(setThreadNotificationLevelRequestSchema.safeParse({ level }).success).toBe(true);
    }
    expect(setThreadNotificationLevelRequestSchema.safeParse({ level: "loud" }).success).toBe(false);
    expect(setThreadNotificationLevelRequestSchema.safeParse({}).success).toBe(false);
    expect(
      setThreadNotificationLevelRequestSchema.safeParse({ level: "all", extra: 1 }).success,
    ).toBe(false);
  });

  it("accepts only the three push kinds in a verdict query", () => {
    for (const kind of ["pending-interaction", "thread-error", "turn-finished"]) {
      expect(threadNotificationVerdictQuerySchema.safeParse({ kind }).success).toBe(true);
    }
    expect(threadNotificationVerdictQuerySchema.safeParse({ kind: "shout" }).success).toBe(false);
  });

  it("builds the canonical routes", () => {
    const client = createPublicApiClient("http://localhost:3334");
    const param = { id: "thr_123" };
    expect(client.threads[":id"]["notification-level"].$url({ param }).pathname).toBe(
      "/api/v1/threads/thr_123/notification-level",
    );
    expect(client.threads[":id"]["notification-verdict"].$url({ param, query: { kind: "turn-finished" } }).pathname).toBe(
      "/api/v1/threads/thr_123/notification-verdict",
    );
  });
});
