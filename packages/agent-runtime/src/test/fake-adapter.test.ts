import { describe, expect, it } from "vitest";
import { getThreadEventScopeTurnId } from "@zana-ai/zcc-domain/thread-runtime";
import { THREAD_DELTA_NOTIFICATION_METHOD } from "@zana-ai/zcc-provider-bridge-protocol";
import { createFakeAdapter } from "./fake-adapter.js";

describe("fake adapter thread/delta", () => {
  it("assembles a v2 turn into the same turn-1 scoped events tests wait on", () => {
    const adapter = createFakeAdapter();
    const events = adapter.translateEvent({
      jsonrpc: "2.0",
      method: THREAD_DELTA_NOTIFICATION_METHOD,
      params: {
        threadId: "t1",
        deltas: [
          { kind: "turn.open", providerTurnId: "turn-1" },
          {
            kind: "input.accepted",
            clientRequestId: "creq_222222222s",
            providerTurnId: "turn-1",
          },
          {
            kind: "item.open",
            key: { providerItemId: "msg-1" },
            item: { type: "agentMessage", text: "" },
            providerTurnId: "turn-1",
          },
          {
            kind: "item.close",
            key: { providerItemId: "msg-1" },
            status: "completed",
            item: { type: "agentMessage", text: "Response to: hi" },
            providerTurnId: "turn-1",
          },
          { kind: "turn.boundary", status: "completed", providerTurnId: "turn-1" },
        ],
      },
    });
    expect(events.map((event) => event.type)).toEqual([
      "turn/started",
      "turn/input/accepted",
      "item/started",
      "item/completed",
      "turn/completed",
    ]);
    expect(events.every((event) => getThreadEventScopeTurnId(event.scope) === "turn-1")).toBe(
      true,
    );
  });

  it("keeps turn.open when a sibling input.accepted id fails the creq schema", () => {
    const adapter = createFakeAdapter();
    const events = adapter.translateEvent({
      jsonrpc: "2.0",
      method: THREAD_DELTA_NOTIFICATION_METHOD,
      params: {
        threadId: "t1",
        deltas: [
          { kind: "turn.open", providerTurnId: "turn-1" },
          {
            kind: "input.accepted",
            clientRequestId: "creq_rate_limited01",
            providerTurnId: "turn-1",
          },
        ],
      },
    });
    expect(events.map((event) => event.type)).toEqual(["turn/started"]);
  });
});
