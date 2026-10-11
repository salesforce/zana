import { threadScope } from "@zana-ai/zcc-domain/thread-runtime";
import { describe, expect, it } from "vitest";
import { createClaudeDeltaHarness } from "./delta-test-harness.js";
import { claudeCodeVisibilityMetadata } from "./visibility.js";

const UI_SUBTYPES = [
  "ui_invalidate",
  "ui_log",
  "ui_toast",
  "ui_status",
  "ui_panes",
  "ui_scroll",
  "ui_focus",
];

function systemEnvelope(subtype: string | undefined) {
  return {
    jsonrpc: "2.0" as const,
    method: "sdk/message",
    params: {
      threadId: "ui-thread",
      message: { type: "system", subtype, session_id: "ui-session" },
    },
  };
}

describe("Claude plugin UI system pushes", () => {
  it.each(UI_SUBTYPES)(
    "ignores %s without creating diagnostic timeline events",
    (subtype) => {
      const harness = createClaudeDeltaHarness();

      const events = harness.translate({
        jsonrpc: "2.0",
        method: "sdk/message",
        params: {
          threadId: "ui-thread",
          message: {
            type: "system",
            subtype,
            session_id: "ui-session",
            uuid: "ui-message",
          },
        },
      });

      expect(events).toEqual([]);
    },
  );

  it.each(UI_SUBTYPES)("classifies %s as noise", (subtype) => {
    expect(
      claudeCodeVisibilityMetadata.describeRawEvent(systemEnvelope(subtype)),
    ).toEqual({ kind: `sdk/system:${subtype}`, coverage: "noise" });
  });

  it.each(["unrecognized_system_event", "ui_unrecognized", undefined])(
    "preserves diagnostics for an unsupported system subtype %s",
    (subtype) => {
      const harness = createClaudeDeltaHarness();

      const events = harness.translate(systemEnvelope(subtype));

      expect(events).toEqual([
        expect.objectContaining({
          type: "provider/unhandled",
          rawType: "sdk/system",
          providerId: "claude-code",
          scope: threadScope(),
        }),
      ]);
    },
  );
});
