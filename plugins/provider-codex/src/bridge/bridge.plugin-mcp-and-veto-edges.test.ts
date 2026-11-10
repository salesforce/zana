import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { experimental_createBridgeJsonRpcTestHarness as createBridgeJsonRpcTestHarness } from "@zana-ai/zcc-plugin-sdk/provider-bridge/testing";
import { handleLine } from "./bridge.js";
import {
  FULL_ACCESS_SESSION_OPTIONS,
  stubFakeCodexAppServer,
} from "./fake-codex-app-server-harness.js";

// Edge coverage for the plugin MCP server pass-through and the native-tool veto
// / settled-report paths that bridge.native-tool-veto.test.ts does not reach.

let harness: ReturnType<typeof createBridgeJsonRpcTestHarness>;
let workspace: string;
let requestLogPath: string;
let activeThreadId: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "bb-codex-edges-"));
  requestLogPath = join(workspace, "requests.jsonl");
  harness = createBridgeJsonRpcTestHarness(handleLine);
});

afterEach(async () => {
  harness.sendRequest(999, "thread/stop", {
    threadId: activeThreadId,
    providerThreadId: "codex-thread",
    intent: "release",
    activeTurnId: null,
  });
  await harness.waitForResponse(999).catch(() => undefined);
  harness.restore();
  vi.unstubAllEnvs();
  rmSync(workspace, { recursive: true, force: true });
});

function loggedRequests(method: string): { params: { config?: Record<string, unknown> } }[] {
  return readFileSync(requestLogPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((entry) => entry.method === method);
}

const PLUGIN_SERVERS = [
  { name: "plugin_a_s", type: "stdio", command: "node", args: ["a.js"], env: { TOKEN: "t", "BAD.KEY": "x" } },
  { name: "plugin_a_h", type: "http", url: "https://x.test/mcp" },
  { name: "plugin_nocmd", type: "stdio" },
];

function stubScript(extra: Record<string, unknown>): string {
  const scriptPath = join(workspace, "script.json");
  writeFileSync(scriptPath, JSON.stringify({ requestLogPath, ...extra }));
  stubFakeCodexAppServer(scriptPath);
  return scriptPath;
}

it("adds host-selected plugin MCP servers to the Codex thread config, skipping unlaunchable entries", async () => {
  activeThreadId = "thr_mcp_start";
  stubScript({});
  harness.sendRequest(1, "thread/start", {
    threadId: activeThreadId,
    cwd: workspace,
    instructionMode: "append",
    options: FULL_ACCESS_SESSION_OPTIONS,
    mcpServers: PLUGIN_SERVERS,
  });
  const start = await harness.waitForResponse(1);
  expect(start.error).toBeUndefined();

  const config = loggedRequests("thread/start")[0]?.params.config;
  expect(config).toMatchObject({
    "mcp_servers.plugin_a_s.command": "node",
    "mcp_servers.plugin_a_s.args": ["a.js"],
    "mcp_servers.plugin_a_s.env.TOKEN": "t",
    "mcp_servers.plugin_a_h.url": "https://x.test/mcp",
  });
  expect(JSON.stringify(config)).not.toContain("BAD.KEY");
  expect(JSON.stringify(config)).not.toContain("plugin_nocmd");
});

it("leaves the Codex config free of MCP keys when no plugin servers are selected", async () => {
  activeThreadId = "thr_mcp_none";
  stubScript({});
  harness.sendRequest(1, "thread/start", {
    threadId: activeThreadId,
    cwd: workspace,
    instructionMode: "append",
    options: FULL_ACCESS_SESSION_OPTIONS,
    mcpServers: [],
  });
  expect((await harness.waitForResponse(1)).error).toBeUndefined();
  const config = loggedRequests("thread/start")[0]?.params.config ?? {};
  expect(Object.keys(config).filter((key) => key.startsWith("mcp_servers."))).toEqual([]);
});

it("re-applies plugin MCP servers when a settings change rebuilds the session", async () => {
  activeThreadId = "thr_mcp_rebuild";
  stubScript({});
  harness.sendRequest(1, "thread/resume", {
    threadId: activeThreadId,
    providerThreadId: "codex-thread",
    cwd: workspace,
    instructionMode: "append",
    options: { ...FULL_ACCESS_SESSION_OPTIONS, reasoningLevel: "low" },
    mcpServers: PLUGIN_SERVERS,
  });
  expect((await harness.waitForResponse(1)).error).toBeUndefined();
  harness.sendRequest(2, "turn/start", {
    threadId: activeThreadId,
    providerThreadId: "codex-thread",
    clientRequestId: "creq_a2b3c4d5e6",
    input: [{ type: "text", text: "hi", mentions: [] }],
    options: { ...FULL_ACCESS_SESSION_OPTIONS, reasoningLevel: "high" },
  });
  expect((await harness.waitForResponse(2)).error).toBeUndefined();

  const resumes = loggedRequests("thread/resume");
  expect(resumes.length).toBeGreaterThanOrEqual(2);
  for (const resume of resumes) {
    expect(resume.params.config).toMatchObject({
      "mcp_servers.plugin_a_s.command": "node",
    });
  }
});

const TURN_STARTED = {
  method: "turn/started",
  params: { threadId: "codex-thread", turn: { id: "turn-1", status: "inProgress" } },
};
const TURN_COMPLETED = {
  method: "turn/completed",
  params: { threadId: "codex-thread", turn: { id: "turn-1", status: "completed" } },
};

async function startApprovalTurn(): Promise<void> {
  harness.sendRequest(1, "thread/start", {
    threadId: activeThreadId,
    cwd: workspace,
    instructionMode: "append",
    options: FULL_ACCESS_SESSION_OPTIONS,
  });
  const start = await harness.waitForResponse(1);
  expect(start.error).toBeUndefined();
  harness.sendRequest(2, "turn/start", {
    threadId: activeThreadId,
    providerThreadId: "codex-thread",
    input: [{ type: "text", text: "Act", mentions: [] }],
    clientRequestId: "creq_a2b3c4d5e6",
    options: FULL_ACCESS_SESSION_OPTIONS,
  });
  await vi.waitFor(() => {
    expect(harness.messages.some((m) => m.method === "tool/policy/decide")).toBe(true);
  });
}

function allowPolicy(): void {
  const policy = harness.messages.find((m) => m.method === "tool/policy/decide");
  handleLine(JSON.stringify({ jsonrpc: "2.0", id: policy?.id, result: { action: "allow" } }));
}

it("reports a declined file change as cancelled without exit code or output", async () => {
  activeThreadId = "thr_settled_declined";
  stubScript({
    turns: [[
      TURN_STARTED,
      {
        kind: "request",
        method: "item/fileChange/requestApproval",
        params: { threadId: "codex-thread", turnId: "turn-1", itemId: "patch-1", grantRoot: null },
      },
      {
        method: "item/completed",
        params: {
          threadId: "codex-thread",
          turnId: "turn-1",
          completedAtMs: 0,
          item: { type: "fileChange", id: "patch-1", changes: [], status: "declined" },
        },
      },
      TURN_COMPLETED,
    ]],
  });
  await startApprovalTurn();
  allowPolicy();
  const settled = await vi.waitFor(() => {
    const found = harness.messages.find((m) => m.method === "tool/policy/settled");
    expect(found).toBeDefined();
    return found;
  });
  expect(settled?.params).toMatchObject({
    callId: "patch-1",
    toolName: "codex.file_change",
    state: "cancelled",
  });
  expect(settled?.params).not.toHaveProperty("exitCode");
  expect(settled?.params).not.toHaveProperty("output");
});

it("reports a clean command exit as succeeded and tolerates null output", async () => {
  activeThreadId = "thr_settled_ok";
  stubScript({
    turns: [[
      TURN_STARTED,
      {
        kind: "request",
        method: "item/commandExecution/requestApproval",
        params: {
          threadId: "codex-thread",
          turnId: "turn-1",
          itemId: "cmd-ok",
          command: "true",
          cwd: "/tmp",
          commandActions: [],
          availableDecisions: ["accept", "decline"],
        },
      },
      {
        method: "item/completed",
        params: {
          threadId: "codex-thread",
          turnId: "turn-1",
          completedAtMs: 0,
          item: {
            type: "commandExecution",
            id: "cmd-ok",
            command: "true",
            cwd: "/tmp",
            source: "agent",
            status: "completed",
            commandActions: [],
            aggregatedOutput: null,
            exitCode: 0,
            durationMs: 1,
          },
        },
      },
      TURN_COMPLETED,
    ]],
  });
  await startApprovalTurn();
  allowPolicy();
  const settled = await vi.waitFor(() => {
    const found = harness.messages.find((m) => m.method === "tool/policy/settled");
    expect(found).toBeDefined();
    return found;
  });
  expect(settled?.params).toMatchObject({
    callId: "cmd-ok",
    toolName: "codex.command",
    state: "succeeded",
    exitCode: 0,
  });
  expect(settled?.params).not.toHaveProperty("output");
});

it("refuses the approval when the session is released while the policy decision is in flight", async () => {
  activeThreadId = "thr_veto_released";
  const responseLogPath = join(workspace, "responses.jsonl");
  stubScript({
    responseLogPath,
    turns: [[
      TURN_STARTED,
      {
        kind: "request",
        method: "item/commandExecution/requestApproval",
        params: {
          threadId: "codex-thread",
          turnId: "turn-1",
          itemId: "cmd-late",
          command: "rm -rf /tmp/scratch",
          cwd: "/tmp",
          commandActions: [],
          availableDecisions: ["accept", "decline"],
        },
      },
      TURN_COMPLETED,
    ]],
  });
  await startApprovalTurn();
  harness.sendRequest(3, "thread/stop", {
    threadId: activeThreadId,
    providerThreadId: "codex-thread",
    intent: "release",
    activeTurnId: null,
  });
  await harness.waitForResponse(3).catch(() => undefined);
  // A late allow must not turn into an approval on the dead session.
  allowPolicy();
  await new Promise((resolve) => setTimeout(resolve, 100));
  let logged = "";
  try {
    logged = readFileSync(responseLogPath, "utf8");
  } catch {
    // child torn down before it could log: nothing was approved either way
  }
  expect(logged).not.toContain('"decision":"accept"');
  expect(harness.messages.some((m) => m.method === "interaction/request")).toBe(false);
});
