import { afterEach, beforeEach, expect, it } from "vitest";
import { experimental_createBridgeJsonRpcTestHarness as createBridgeJsonRpcTestHarness } from "@zana-ai/zcc-plugin-sdk/provider-bridge/testing";
import { handleLine } from "./bridge.js";

let harness: ReturnType<typeof createBridgeJsonRpcTestHarness>;

beforeEach(() => {
  harness = createBridgeJsonRpcTestHarness(handleLine);
});

afterEach(() => {
  harness.restore();
});

it("advertises the codex capability set on initialize", async () => {
  harness.sendRequest(1, "initialize", {
    protocolVersion: 2,
    client: { name: "test", version: "0" },
    grammarVersions: [3, 3],
  });
  const response = await harness.waitForResponse(1);

  expect(response.error).toBeUndefined();
  expect(response.result).toMatchObject({
    capabilities: {
      sessionRestore: true,
      threadArchive: true,
      threadRename: true,
      threadGoalClear: true,
      backgroundTaskStop: false,
      fork: "checkpoint",
      approvalEnforcedBy: "runtime",
      steerMode: "inject",
      skills: { configure: true },
    },
  });
});
