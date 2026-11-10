import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { experimental_createBridgeJsonRpcTestHarness as createBridgeJsonRpcTestHarness } from "@zana-ai/zcc-plugin-sdk/provider-bridge/testing";
import { handleLine } from "./bridge.js";
import {
  FULL_ACCESS_SESSION_OPTIONS,
  stubFakeCodexAppServer,
} from "./fake-codex-app-server-harness.js";

// OBL-018/p0-modern-codex-veto: under approvalPolicy:"untrusted" codex raises a
// command/file-change approval for every such call even in full access. The bridge
// must route those through the host native-tool policy ("tool/policy/decide") and
// synthesize the codex approval response from the decision WITHOUT a human prompt
// ("interaction/request"). Allow -> accept, deny -> decline, teardown/transport ->
// fail closed. permission_grant + user_question still take the human path.

afterEach(() => vi.unstubAllEnvs());

interface ApprovalFixture {
  method: "item/commandExecution/requestApproval" | "item/fileChange/requestApproval";
  params: Record<string, unknown>;
}

const COMMAND_APPROVAL: ApprovalFixture = {
  method: "item/commandExecution/requestApproval",
  params: {
    threadId: "codex-thread",
    turnId: "turn-1",
    itemId: "cmd-item-1",
    command: "rm -rf /tmp/scratch",
    cwd: "/tmp",
    commandActions: [],
    availableDecisions: ["accept", "acceptForSession", "decline"],
  },
};

const FILE_CHANGE_APPROVAL: ApprovalFixture = {
  method: "item/fileChange/requestApproval",
  params: {
    threadId: "codex-thread",
    turnId: "turn-1",
    itemId: "patch-item-1",
    grantRoot: null,
  },
};

function writeApprovalScript(
  workspace: string,
  responseLogPath: string,
  fixture: ApprovalFixture,
): string {
  const scriptPath = join(workspace, "script.json");
  writeFileSync(
    scriptPath,
    JSON.stringify({
      responseLogPath,
      turns: [
        [
          {
            method: "turn/started",
            params: {
              threadId: "codex-thread",
              turn: { id: "turn-1", status: "inProgress" },
            },
          },
          { kind: "request", method: fixture.method, params: fixture.params },
          {
            method: "turn/completed",
            params: {
              threadId: "codex-thread",
              turn: { id: "turn-1", status: "completed" },
            },
          },
        ],
      ],
    }),
  );
  return scriptPath;
}

async function driveApprovalToPolicy(
  bridge: ReturnType<typeof createBridgeJsonRpcTestHarness>,
  workspace: string,
  threadId: string,
  sessionOptions: typeof FULL_ACCESS_SESSION_OPTIONS = FULL_ACCESS_SESSION_OPTIONS,
) {
  bridge.sendRequest(1, "thread/start", {
    threadId,
    cwd: workspace,
    instructionMode: "append",
    options: sessionOptions,
  });
  const start = await bridge.waitForResponse(1);
  if (start.error) throw new Error(JSON.stringify(start.error));
  const providerThreadId = (start.result as { providerThreadId: string })
    .providerThreadId;
  bridge.sendRequest(2, "turn/start", {
    threadId,
    providerThreadId,
    input: [{ type: "text", text: "Act", mentions: [] }],
    clientRequestId: "creq_a2b3c4d5e6",
    options: sessionOptions,
  });
  await vi.waitFor(() => {
    expect(
      bridge.messages.some((message) => message.method === "tool/policy/decide"),
    ).toBe(true);
  });
}

it.each([
  { name: "command", fixture: COMMAND_APPROVAL, decision: "accept" },
  { name: "file-change", fixture: FILE_CHANGE_APPROVAL, decision: "accept" },
])(
  "routes a Codex $name approval through the native-tool policy and allows without a human prompt",
  async ({ fixture, decision }) => {
    const workspace = mkdtempSync(join(tmpdir(), "bb-codex-veto-allow-"));
    const responseLogPath = join(workspace, "responses.jsonl");
    writeApprovalScript(workspace, responseLogPath, fixture);
    stubFakeCodexAppServer(join(workspace, "script.json"));
    const bridge = createBridgeJsonRpcTestHarness(handleLine);
    try {
      await driveApprovalToPolicy(bridge, workspace, "thr_veto_allow");
      // The veto point does NOT raise a human interaction request.
      expect(
        bridge.messages.some(
          (message) => message.method === "interaction/request",
        ),
      ).toBe(false);
      const policy = bridge.messages.find(
        (message) => message.method === "tool/policy/decide",
      );
      expect(policy?.params).toMatchObject({ threadId: "thr_veto_allow" });
      handleLine(
        JSON.stringify({
          jsonrpc: "2.0",
          id: policy?.id,
          result: { action: "allow" },
        }),
      );
      await bridge.waitForResponse(2);
      await vi.waitFor(() => {
        expect(readFileSync(responseLogPath, "utf8").trim()).not.toBe("");
      });
      const logged = JSON.parse(readFileSync(responseLogPath, "utf8").trim());
      expect(logged.result.decision).toBe(decision);
      expect(logged).not.toHaveProperty("error");
    } finally {
      bridge.sendRequest(999, "thread/stop", {
        threadId: "thr_veto_allow",
        providerThreadId: "codex-thread",
        intent: "release",
        activeTurnId: null,
      });
      await bridge.waitForResponse(999).catch(() => undefined);
      bridge.restore();
      rmSync(workspace, { recursive: true, force: true });
    }
  },
  30_000,
);

it("refuses a Codex command when the native-tool policy denies", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "bb-codex-veto-deny-"));
  const responseLogPath = join(workspace, "responses.jsonl");
  writeApprovalScript(workspace, responseLogPath, COMMAND_APPROVAL);
  stubFakeCodexAppServer(join(workspace, "script.json"));
  const bridge = createBridgeJsonRpcTestHarness(handleLine);
  try {
    await driveApprovalToPolicy(bridge, workspace, "thr_veto_deny");
    const policy = bridge.messages.find(
      (message) => message.method === "tool/policy/decide",
    );
    handleLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: policy?.id,
        result: { action: "deny", reason: "blocked by tool policy" },
      }),
    );
    await bridge.waitForResponse(2);
    await vi.waitFor(() => {
      expect(readFileSync(responseLogPath, "utf8").trim()).not.toBe("");
    });
    const logged = JSON.parse(readFileSync(responseLogPath, "utf8").trim());
    expect(logged.result.decision).toBe("decline");
  } finally {
    bridge.sendRequest(999, "thread/stop", {
      threadId: "thr_veto_deny",
      providerThreadId: "codex-thread",
      intent: "release",
      activeTurnId: null,
    });
    await bridge.waitForResponse(999).catch(() => undefined);
    bridge.restore();
    rmSync(workspace, { recursive: true, force: true });
  }
}, 30_000);

it("fails closed to decline when the policy reply is malformed", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "bb-codex-veto-malformed-"));
  const responseLogPath = join(workspace, "responses.jsonl");
  writeApprovalScript(workspace, responseLogPath, COMMAND_APPROVAL);
  stubFakeCodexAppServer(join(workspace, "script.json"));
  const bridge = createBridgeJsonRpcTestHarness(handleLine);
  try {
    await driveApprovalToPolicy(bridge, workspace, "thr_veto_bad");
    const policy = bridge.messages.find(
      (message) => message.method === "tool/policy/decide",
    );
    // An unparseable decision result must settle as deny, never as allow.
    handleLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: policy?.id,
        result: { action: "maybe" },
      }),
    );
    await bridge.waitForResponse(2);
    await vi.waitFor(() => {
      expect(readFileSync(responseLogPath, "utf8").trim()).not.toBe("");
    });
    const logged = JSON.parse(readFileSync(responseLogPath, "utf8").trim());
    expect(logged.result.decision).toBe("decline");
  } finally {
    bridge.sendRequest(999, "thread/stop", {
      threadId: "thr_veto_bad",
      providerThreadId: "codex-thread",
      intent: "release",
      activeTurnId: null,
    });
    await bridge.waitForResponse(999).catch(() => undefined);
    bridge.restore();
    rmSync(workspace, { recursive: true, force: true });
  }
}, 30_000);

it("reports tool/policy/settled after an allowed command completes (OBL-011)", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "bb-codex-settled-"));
  const responseLogPath = join(workspace, "responses.jsonl");
  const scriptPath = join(workspace, "script.json");
  writeFileSync(
    scriptPath,
    JSON.stringify({
      responseLogPath,
      turns: [
        [
          {
            method: "turn/started",
            params: {
              threadId: "codex-thread",
              turn: { id: "turn-1", status: "inProgress" },
            },
          },
          {
            kind: "request",
            method: COMMAND_APPROVAL.method,
            params: COMMAND_APPROVAL.params,
          },
          {
            method: "item/completed",
            params: {
              threadId: "codex-thread",
              turnId: "turn-1",
              completedAtMs: 0,
              item: {
                type: "commandExecution",
                id: "cmd-item-1",
                command: "rm -rf /tmp/scratch",
                cwd: "/tmp",
                processId: null,
                pluginId: null,
                scriptPath: null,
                source: "agent",
                status: "failed",
                commandActions: [],
                aggregatedOutput: "boom\n",
                exitCode: 2,
                durationMs: 5,
              },
            },
          },
          {
            method: "turn/completed",
            params: {
              threadId: "codex-thread",
              turn: { id: "turn-1", status: "completed" },
            },
          },
        ],
      ],
    }),
  );
  stubFakeCodexAppServer(scriptPath);
  const bridge = createBridgeJsonRpcTestHarness(handleLine);
  try {
    await driveApprovalToPolicy(bridge, workspace, "thr_settled");
    const policy = bridge.messages.find(
      (message) => message.method === "tool/policy/decide",
    );
    handleLine(
      JSON.stringify({ jsonrpc: "2.0", id: policy?.id, result: { action: "allow" } }),
    );
    await vi.waitFor(() => {
      expect(
        bridge.messages.some((message) => message.method === "tool/policy/settled"),
      ).toBe(true);
    });
    const settled = bridge.messages.find(
      (message) => message.method === "tool/policy/settled",
    );
    expect(settled?.params).toMatchObject({
      threadId: "thr_settled",
      callId: "cmd-item-1",
      state: "failed",
      exitCode: 2,
      output: "boom\n",
    });
  } finally {
    bridge.sendRequest(999, "thread/stop", {
      threadId: "thr_settled",
      providerThreadId: "codex-thread",
      intent: "release",
      activeTurnId: null,
    });
    await bridge.waitForResponse(999).catch(() => undefined);
    bridge.restore();
    rmSync(workspace, { recursive: true, force: true });
  }
}, 30_000);

it("keeps the human prompt on a policy allow when the session is workspace-scoped", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "bb-codex-veto-ws-"));
  const responseLogPath = join(workspace, "responses.jsonl");
  writeApprovalScript(workspace, responseLogPath, COMMAND_APPROVAL);
  stubFakeCodexAppServer(join(workspace, "script.json"));
  const bridge = createBridgeJsonRpcTestHarness(handleLine);
  try {
    await driveApprovalToPolicy(bridge, workspace, "thr_veto_ws", {
      ...FULL_ACCESS_SESSION_OPTIONS,
      permissionMode: "accept-edits",
      permissionScope: "workspace",
      approvalReviewer: "user",
      permissionEscalation: "ask",
    } as unknown as typeof FULL_ACCESS_SESSION_OPTIONS);
    const policy = bridge.messages.find(
      (message) => message.method === "tool/policy/decide",
    );
    handleLine(
      JSON.stringify({ jsonrpc: "2.0", id: policy?.id, result: { action: "allow" } }),
    );
    // Allow is "no objection": the human still decides under workspace-write.
    await vi.waitFor(() => {
      expect(
        bridge.messages.some((message) => message.method === "interaction/request"),
      ).toBe(true);
    });
    expect(existsSync(responseLogPath) ? readFileSync(responseLogPath, "utf8").trim() : "").toBe("");
  } finally {
    bridge.sendRequest(999, "thread/stop", {
      threadId: "thr_veto_ws",
      providerThreadId: "codex-thread",
      intent: "release",
      activeTurnId: null,
    });
    await bridge.waitForResponse(999).catch(() => undefined);
    bridge.restore();
    rmSync(workspace, { recursive: true, force: true });
  }
}, 30_000);
