import { RELAY_BACKSTOP_MS } from "@zana-ai/zcc-domain/native-tool-policy-budget";
import type { HookCallback, Options, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { experimental_createBridgeJsonRpcTestHarness as createHarness } from "@zana-ai/zcc-plugin-sdk/provider-bridge/testing";
import * as sessionOptionsModule from "../session-options.js";

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: queryMock,
  forkSession: vi.fn(async () => ({ sessionId: "forked-provider" })),
  renameSession: vi.fn(),
  createSdkMcpServer: vi.fn(() => ({})),
  tool: vi.fn((_name, _desc, _schema, handler) => handler),
}));

import { CLAUDE_IDLE_QUERY_GRACE_MS, handleLine } from "../bridge.js";

type Harness = ReturnType<typeof createHarness>;
type HookInput = Parameters<HookCallback>[0];
type PreToolUseInput = Extract<HookInput, { hook_event_name: "PreToolUse" }>;

function controlledQuery() {
  const messages: IteratorResult<SDKMessage>[] = [];
  let next: ((message: IteratorResult<SDKMessage>) => void) | undefined;
  const push = (message: IteratorResult<SDKMessage>) => {
    if (next) {
      const resolve = next;
      next = undefined;
      resolve(message);
    } else messages.push(message);
  };
  const finish = () => push({ done: true, value: undefined });
  return {
    close: vi.fn(finish),
    finish,
    emit: (message: SDKMessage) => push({ done: false, value: message }),
    setPermissionMode: vi.fn(async () => {}),
    applyFlagSettings: vi.fn(async () => {}),
    setModel: vi.fn(async () => {}),
    [Symbol.asyncIterator]() {
      return {
        next: () => messages.length
          ? Promise.resolve(messages.shift()!)
          : new Promise<IteratorResult<SDKMessage>>(resolve => { next = resolve; }),
      };
    },
  };
}

function toolInput(overrides: Partial<PreToolUseInput> = {}): PreToolUseInput {
  return {
    hook_event_name: "PreToolUse",
    session_id: "untrusted-hook-session",
    tool_name: "Bash",
    tool_input: { command: "touch should-not-run" },
    tool_use_id: "native-call-1",
    transcript_path: "/tmp/transcript.jsonl",
    cwd: "/tmp/worktree",
    ...overrides,
  };
}

function options(policy: "accept-edits" | "auto" | "full" = "accept-edits", plan = false) {
  return {
    permissionMode: policy,
    permissionScope: policy === "full" ? "full" : "workspace",
    permissionEscalation: policy === "full" ? null : "ask",
    approvalReviewer: policy === "full" ? null : policy === "auto" ? "automatic" : "user",
    providerOptions: { workflowsEnabled: false, idleQueryReleaseEnabled: true,
      ...(plan ? { claudeCodePermissionMode: "plan" } : {}),
    },
  };
}

describe("Claude native tool veto", () => {
  let bridge: Harness;
  let queries: ReturnType<typeof controlledQuery>[];
  let threadId: string;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.clearAllMocks();
    bridge = createHarness(handleLine);
    queries = [];
    threadId = "thread-native-policy-focused";
    queryMock.mockImplementation(() => {
      const query = controlledQuery();
      queries.push(query);
      return query;
    });
  });

  afterEach(async () => {
    vi.useRealTimers();
    bridge.sendRequest(999, "thread/stop", {
      threadId, providerThreadId: "unused", intent: "interrupt", activeTurnId: null,
    });
    queries.forEach(query => query.finish());
    await bridge.waitForResponse(999);
    bridge.restore();
    vi.restoreAllMocks();
  });

  function latestOptions(): Options {
    return queryMock.mock.calls.at(-1)![0].options as Options;
  }

  function hook(): HookCallback {
    const matchers = latestOptions().hooks?.PreToolUse;
    expect(matchers).toHaveLength(1);
    expect(matchers![0].hooks).toHaveLength(1);
    return matchers![0].hooks[0];
  }

  async function flush() {
    await new Promise<void>(resolve => setImmediate(resolve));
    await vi.advanceTimersByTimeAsync(0);
  }

  async function response(id: number) {
    const pending = bridge.waitForResponse(id);
    await flush();
    return pending;
  }

  async function start(policy: "accept-edits" | "auto" | "full" = "accept-edits", plan = false) {
    bridge.sendRequest(1, "thread/start", {
      threadId, cwd: "/tmp/worktree", instructionMode: "append", options: options(policy, plan),
    });
    const started = await response(1);
    const providerThreadId = (started.result as { providerThreadId: string }).providerThreadId;
    bridge.takeMessages();
    return providerThreadId;
  }

  function invoke(input = toolInput(), callback = hook(), signal = new AbortController().signal) {
    const output = callback(input, "ignored-sdk-tool-use-id", { signal });
    const request = bridge.takeMessages().find(message => message.method === "tool/policy/decide");
    expect(request).toBeDefined();
    return { output, request: request! };
  }

  function reply(id: string | number, result: unknown) {
    handleLine(JSON.stringify({ jsonrpc: "2.0", id, result }));
  }

  const deny = (reason?: string) => ({
    continue: true,
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      ...(reason === undefined ? {} : { permissionDecisionReason: reason }),
    },
  });

  it.each([
    ["accept-edits", false, "acceptEdits"],
    ["auto", false, "auto"],
    ["full", false, "bypassPermissions"],
    ["accept-edits", true, "plan"],
  ] as const)("vetoes %s (plan=%s), without granting provider permission", async (policy, plan, sdkMode) => {
    const providerThreadId = await start(policy, plan);
    expect(latestOptions().permissionMode).toBe(sdkMode);
    if (policy !== "full") expect(latestOptions().sandbox?.enabled).toBe(true);
    const input = toolInput();
    const allowed = invoke(input);
    expect(allowed.request.params).toEqual({
      threadId, providerThreadId, callId: input.tool_use_id, toolName: input.tool_name, input: input.tool_input,
    });
    expect(providerThreadId).not.toBe(input.session_id);
    reply(allowed.request.id!, { action: "allow" });
    await expect(allowed.output).resolves.toEqual({ continue: true });
    const blocked = invoke(input);
    reply(blocked.request.id!, { action: "deny", reason: "Plugin veto" });
    await expect(blocked.output).resolves.toEqual(deny("Plugin veto"));
  });

  it("announces live provider identity before policy requests during SDK bootstrap", async () => {
    let bootstrapOutput: ReturnType<HookCallback> | undefined;
    queryMock.mockImplementation((args: { options: Options }) => {
      const query = controlledQuery();
      queries.push(query);
      bootstrapOutput = args.options.hooks!.PreToolUse![0].hooks[0](
        toolInput(), undefined, { signal: new AbortController().signal },
      );
      return query;
    });
    bridge.sendRequest(1, "thread/start", {
      threadId, cwd: "/tmp/worktree", instructionMode: "append", options: options(),
    });
    await response(1);
    const identityIndex = bridge.messages.findIndex(message => message.method === "thread/identity");
    const requestIndex = bridge.messages.findIndex(message => message.method === "tool/policy/decide");
    expect(identityIndex).toBeGreaterThanOrEqual(0);
    expect(identityIndex).toBeLessThan(requestIndex);
    const request = bridge.messages[requestIndex];
    expect(request.params?.providerThreadId).toBe(bridge.messages[identityIndex].params?.providerThreadId);
    reply(request.id!, { action: "allow" });
    await expect(bootstrapOutput).resolves.toEqual({ continue: true });
  });

  it.each(["default", "dontAsk"] as const)("preserves %s readonly decisions only after native policy allows", async permissionMode => {
    const build = sessionOptionsModule.buildSessionOptions;
    vi.spyOn(sessionOptionsModule, "buildSessionOptions").mockImplementation((args, env) => build({
      ...args, permissionMode, getPermissionEscalation: () => permissionMode === "dontAsk" ? "deny" : "ask",
    }, env));
    await start();
    const denied = invoke(toolInput({ tool_input: { command: "git status --short" } }));
    reply(denied.request.id!, { action: "deny", reason: "No git" });
    await expect(denied.output).resolves.toEqual(deny("No git"));
    const allowed = invoke(toolInput({ tool_input: { command: "git status --short" } }));
    reply(allowed.request.id!, { action: "allow" });
    await expect(allowed.output).resolves.toMatchObject({ hookSpecificOutput: {
      permissionDecision: "allow", updatedInput: { command: "git --no-optional-locks status --short" },
    } });
    const write = invoke(toolInput({ tool_name: "Write", tool_input: { file_path: "/tmp/file" } }));
    reply(write.request.id!, { action: "allow" });
    await expect(write.output).resolves.toMatchObject({ hookSpecificOutput: {
      permissionDecision: permissionMode === "dontAsk" ? "deny" : "ask",
    } });
  });

  it("does not turn native policy allow into a workspace approval", async () => {
    await start();
    const input = toolInput();
    const native = invoke(input);
    reply(native.request.id!, { action: "allow" });
    await expect(native.output).resolves.toEqual({ continue: true });
    const permission = latestOptions().canUseTool!("Bash", input.tool_input as Record<string, unknown>, {
      signal: new AbortController().signal, toolUseID: input.tool_use_id,
      blockedPath: "/outside", requestId: "provider-approval",
    });
    await flush();
    const approval = bridge.messages.find(message => message.method === "interaction/request");
    expect(approval).toBeDefined();
    reply(approval!.id!, { decision: "deny", grantedPermissions: null });
    await expect(permission).resolves.toMatchObject({ behavior: "deny" });
  });

  it("vetoes cached session approvals on each native execution", async () => {
    await start();
    const input = { file_path: "/outside/file" };
    const use = (toolUseID: string) => latestOptions().canUseTool!("Read", input, {
      signal: new AbortController().signal, toolUseID, blockedPath: "/outside", requestId: "read-approval",
    });
    const grant = use("grant-call");
    await flush();
    const approval = bridge.takeMessages().find(message => message.method === "interaction/request");
    expect(approval).toBeDefined();
    reply(approval!.id!, { decision: "allow_for_session", grantedPermissions: {
      network: null, fileSystem: { read: ["/outside"], write: [] },
    } });
    await expect(grant).resolves.toMatchObject({ behavior: "allow" });
    await expect(use("cached-call")).resolves.toMatchObject({ behavior: "allow", decisionClassification: "user_permanent" });
    expect(bridge.takeMessages().some(message => message.method === "interaction/request")).toBe(false);
    const native = invoke(toolInput({ tool_name: "Read", tool_input: input, tool_use_id: "cached-call" }));
    reply(native.request.id!, { action: "deny", reason: "Cached approval cannot bypass veto" });
    await expect(native.output).resolves.toEqual(deny("Cached approval cannot bypass veto"));
  });

  it.each([null, {}, { action: "allow", input: {} }, { action: "allow", reason: "extra" },
    { action: "deny" }, { action: "ask" }, { behavior: "allow" }])("rejects invalid policy reply %j", async result => {
    await start();
    const pending = invoke();
    reply(pending.request.id!, result);
    await expect(pending.output).resolves.toEqual(deny("native policy reply unavailable or invalid"));
  });

  it("rejects RPC errors and ignores replayed allows for later executions", async () => {
    await start();
    const first = invoke();
    reply(first.request.id!, { action: "allow" });
    await expect(first.output).resolves.toEqual({ continue: true });
    const second = invoke();
    expect(second.request.id).not.toBe(first.request.id);
    const settled = vi.fn();
    void second.output.then(settled);
    reply(first.request.id!, { action: "allow" });
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    handleLine(JSON.stringify({ jsonrpc: "2.0", id: second.request.id,
      error: { code: -32000, message: "Host unavailable" } }));
    await expect(second.output).resolves.toEqual(deny("native policy reply unavailable or invalid"));
  });

  it("times out closed and ignores late allow", async () => {
    await start();
    const pending = invoke();
    await vi.advanceTimersByTimeAsync(RELAY_BACKSTOP_MS);
    await expect(pending.output).resolves.toEqual(deny("native policy timed out"));
    reply(pending.request.id!, { action: "allow" });
    const next = invoke();
    reply(next.request.id!, { action: "deny", reason: "Still blocked" });
    await expect(next.output).resolves.toEqual(deny("Still blocked"));
  });

  it.each(["before", "pending", "after-reply"])("honors SDK abort %s", async phase => {
    await start();
    const controller = new AbortController();
    if (phase === "before") controller.abort();
    const output = hook()(toolInput(), undefined, { signal: controller.signal });
    const request = bridge.takeMessages().find(message => message.method === "tool/policy/decide");
    if (phase === "before") expect(request).toBeUndefined();
    else {
      expect(request).toBeDefined();
      if (phase === "after-reply") reply(request!.id!, { action: "allow" });
      controller.abort();
    }
    await expect(output).resolves.toEqual(deny("native policy cancelled"));
    if (request) reply(request.id!, { action: "allow" });
  });

  it.each(["stop", "discard", "stream-end", "replace"])("cancels pending decisions on %s and rejects stale callbacks", async action => {
    await start();
    const oldHook = hook();
    const pending = invoke(toolInput(), oldHook);
    if (action === "stream-end") {
      queries[0].finish();
      await flush();
    } else if (action === "replace") await start();
    else {
      bridge.sendRequest(3, `thread/${action}`, {
        threadId, providerThreadId: "unused", intent: "interrupt", activeTurnId: null,
      });
      queries[0].finish();
      await response(3);
    }
    await expect(pending.output).resolves.toMatchObject(deny());
    reply(pending.request.id!, { action: "allow" });
    bridge.takeMessages();
    await expect(oldHook(toolInput(), undefined, { signal: new AbortController().signal }))
      .resolves.toEqual(deny("Native tool policy session unavailable"));
    expect(bridge.takeMessages().some(message => message.method === "tool/policy/decide")).toBe(false);
    if (action === "replace") {
      const live = invoke();
      reply(live.request.id!, { action: "allow" });
      await expect(live.output).resolves.toEqual({ continue: true });
    }
  });

  it("rejects allow settled just before session replacement", async () => {
    await start();
    const pending = invoke();
    reply(pending.request.id!, { action: "allow" });
    bridge.sendRequest(3, "thread/stop", {
      threadId, providerThreadId: "unused", intent: "interrupt", activeTurnId: null,
    });
    queries[0].finish();
    await expect(pending.output).resolves.toEqual(deny("Native tool policy session unavailable"));
    await response(3);
  });

  it("rejects provider identity changed while awaiting policy", async () => {
    await start();
    const pending = invoke();
    queries[0].emit({ type: "system", subtype: "session_state_changed", state: "idle",
      session_id: "replacement-provider", uuid: "00000000-0000-4000-8000-000000000001" });
    await flush();
    reply(pending.request.id!, { action: "allow" });
    await expect(pending.output).resolves.toEqual(deny("Native tool policy session unavailable"));
  });

  it("keeps pending policy work resident, then rejects idle-released callbacks", async () => {
    await start();
    const oldHook = hook();
    await vi.advanceTimersByTimeAsync(CLAUDE_IDLE_QUERY_GRACE_MS - 1);
    const pending = invoke(toolInput(), oldHook);
    await vi.advanceTimersByTimeAsync(1);
    expect(queries[0].close).not.toHaveBeenCalled();
    reply(pending.request.id!, { action: "allow" });
    await expect(pending.output).resolves.toEqual({ continue: true });
    await vi.advanceTimersByTimeAsync(CLAUDE_IDLE_QUERY_GRACE_MS);
    expect(queries[0].close).toHaveBeenCalledOnce();
    await expect(oldHook(toolInput(), undefined, { signal: new AbortController().signal }))
      .resolves.toEqual(deny("Native tool policy session unavailable"));
  });

  it("binds fresh callbacks on in-place resident restart", async () => {
    const providerThreadId = await start();
    const oldHook = hook();
    queries[0].finish();
    await flush();
    bridge.sendRequest(4, "turn/start", {
      threadId, providerThreadId, clientRequestId: "creq_abcdefghjk",
      input: [{ type: "text", text: "Restart" }], options: options(),
    });
    await flush();
    const call = queryMock.mock.calls.at(-1)![0];
    await call.prompt[Symbol.asyncIterator]().next();
    await response(4);
    expect(queries).toHaveLength(2);
    expect(hook()).not.toBe(oldHook);
    await expect(oldHook(toolInput(), undefined, { signal: new AbortController().signal }))
      .resolves.toEqual(deny("Native tool policy session unavailable"));
    const pending = invoke();
    reply(pending.request.id!, { action: "allow" });
    await expect(pending.output).resolves.toEqual({ continue: true });
  });

  it.each([{ tool_input: null }, { tool_input: [] }, { tool_input: "invalid" }])("denies non-record input %j without sending policy request", async ({ tool_input }) => {
    await start();
    await expect(hook()(toolInput({ tool_input }), undefined, { signal: new AbortController().signal }))
      .resolves.toEqual(deny("Invalid native tool input"));
    expect(bridge.takeMessages().some(message => message.method === "tool/policy/decide")).toBe(false);
  });

  it("fails closed when policy transport throws", async () => {
    await start();
    const capture = process.stdout.write;
    const implementation = vi.mocked(capture).getMockImplementation()!;
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => { throw new Error("Pipe closed"); });
    const output = hook()(toolInput(), undefined, { signal: new AbortController().signal });
    stdout.mockImplementation(implementation);
    await expect(output).resolves.toEqual(deny("native policy transport failed"));
  });

  it("isolates cancellation and decisions between resident sessions", async () => {
    await start();
    const firstHook = hook();
    const first = invoke(toolInput(), firstHook);
    const firstThreadId = threadId;
    threadId = "thread-native-policy-second";
    await start();
    const second = invoke();
    bridge.sendRequest(5, "thread/stop", {
      threadId: firstThreadId, providerThreadId: "unused", intent: "interrupt", activeTurnId: null,
    });
    queries[0].finish();
    await response(5);
    await expect(first.output).resolves.toMatchObject(deny());
    const settled = vi.fn();
    void second.output.then(settled);
    reply(first.request.id!, { action: "allow" });
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    reply(second.request.id!, { action: "allow" });
    await expect(second.output).resolves.toEqual({ continue: true });
  });

  it("fails closed when bootstrap identity transport throws", async () => {
    let output: ReturnType<HookCallback> | undefined;
    queryMock.mockImplementation((args: { options: Options }) => {
      const query = controlledQuery();
      queries.push(query);
      const stdout = vi.mocked(process.stdout.write);
      const capture = stdout.getMockImplementation()!;
      stdout.mockImplementation(() => { throw new Error("Identity pipe closed"); });
      output = args.options.hooks!.PreToolUse![0].hooks[0](
        toolInput(), undefined, { signal: new AbortController().signal },
      );
      stdout.mockImplementation(capture);
      return query;
    });
    await start();
    await expect(output).resolves.toEqual(deny("native policy transport failed"));
    expect(bridge.messages.some(message => message.method === "tool/policy/decide")).toBe(false);
  });

  describe("settled reports (OBL-011)", () => {
    function post(): HookCallback {
      const matchers = latestOptions().hooks?.PostToolUse;
      return matchers![0].hooks[0];
    }
    function postFailure(): HookCallback {
      return latestOptions().hooks!.PostToolUseFailure![0].hooks[0];
    }
    const settledOf = () => bridge.takeMessages().filter(message => message.method === "tool/policy/settled");

    async function allowed(input = toolInput()) {
      const providerThreadId = await start();
      const call = invoke(input);
      reply(call.request.id!, { action: "allow" });
      await call.output;
      return providerThreadId;
    }

    it("reports a successful call with the exit code and output after an allow", async () => {
      const providerThreadId = await allowed();
      const output = await post()({
        hook_event_name: "PostToolUse", session_id: "s", transcript_path: "/t", cwd: "/c",
        tool_name: "Bash", tool_input: {}, tool_use_id: "native-call-1",
        tool_response: { stdout: "done", exit_code: 0 },
      } as never, "x", { signal: new AbortController().signal });
      expect(output).toEqual({ continue: true });
      const [event] = settledOf();
      expect(event.params).toMatchObject({
        threadId, providerThreadId, callId: "native-call-1", toolName: "Bash", state: "succeeded",
        exitCode: 0, outputBytes: 4, output: "done",
      });
      expect(Number.isInteger(event.params!.durationMs)).toBe(true);
      expect(event).not.toHaveProperty("id");
    });

    it("maps a failure hook and an interrupt, and reports non-zero exits as failed", async () => {
      await allowed();
      await postFailure()({
        hook_event_name: "PostToolUseFailure", session_id: "s", transcript_path: "/t", cwd: "/c",
        tool_name: "Bash", tool_input: {}, tool_use_id: "native-call-1", error: "boom", is_interrupt: true,
      } as never, "x", { signal: new AbortController().signal });
      expect(settledOf()[0].params).toMatchObject({ state: "cancelled", output: "boom" });
      await post()({
        hook_event_name: "PostToolUse", session_id: "s", transcript_path: "/t", cwd: "/c",
        tool_name: "Bash", tool_input: {}, tool_use_id: "native-call-1", tool_response: { exit_code: 2 },
      } as never, "x", { signal: new AbortController().signal });
      expect(settledOf()[0].params).toMatchObject({ state: "failed", exitCode: 2 });
    });
  });
});
