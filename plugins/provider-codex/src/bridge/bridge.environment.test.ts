import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { experimental_createBridgeJsonRpcTestHarness as createHarness } from "@zana-ai/zcc-plugin-sdk/provider-bridge/testing";
import { handleLine } from "./bridge.js";

const options = { permissionMode: "full", permissionScope: "full", approvalReviewer: null, permissionEscalation: null } as const;
let dir: string;
let harness: ReturnType<typeof createHarness>;
const threads = new Set<string>();
const readLog = (name: string): Array<Record<string, any>> => readFileSync(join(dir, name), "utf8").trim().split("\n").map(line => JSON.parse(line));

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "zcc-codex-env-"));
  const wrapper = join(dir, "fixture.mjs");
  writeFileSync(wrapper, `import { appendFileSync } from 'node:fs';
appendFileSync(${JSON.stringify(join(dir, "launches.jsonl"))}, JSON.stringify({ home: process.env.CODEX_HOME, injected: process.env.SYNTHETIC_SESSION_VALUE }) + '\\n');
await import(${JSON.stringify(new URL("./fake-codex-app-server.mjs", import.meta.url).href)});
`);
  const script = join(dir, "script.json");
  writeFileSync(script, JSON.stringify({ requestLogPath: join(dir, "requests.jsonl") }));
  vi.stubEnv("ZCC_CODEX_BRIDGE_APP_SERVER_COMMAND", process.execPath);
  vi.stubEnv("ZCC_CODEX_BRIDGE_APP_SERVER_ARGS", JSON.stringify([wrapper, script]));
  vi.stubEnv("CODEX_HOME", join(dir, "machine-home"));
  vi.stubEnv("SYNTHETIC_SESSION_VALUE", "machine-value");
  harness = createHarness(handleLine);
});

afterEach(async () => {
  let cleanupId = 9999;
  for (const threadId of threads) {
    harness.sendRequest(cleanupId, "thread/stop", { threadId, providerThreadId: "cleanup", intent: "release", activeTurnId: null });
    await harness.waitForResponse(cleanupId++);
  }
  threads.clear();
  harness.restore();
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

it.each(["thread/start", "thread/resume", "thread/fork"])("uses the selected CODEX_HOME for %s and isolates concurrent sessions", async method => {
  for (const [index, envVars] of [
    { CODEX_HOME: join(dir, "project-home"), SYNTHETIC_SESSION_VALUE: "session-value" },
    undefined,
  ].entries()) {
    const threadId = `env-${index}`;
    threads.add(threadId);
    harness.sendRequest(index, method, { threadId, cwd: dir, instructionMode: "append",
      providerThreadId: "source-thread", sourceProviderThreadId: "source-thread",
      options: { ...options, envVars },
    });
    expect((await harness.waitForResponse(index)).error).toBeUndefined();
  }
  expect(readLog("launches.jsonl")).toEqual([
    { home: join(dir, "project-home"), injected: "machine-value" },
    { home: join(dir, "machine-home"), injected: "machine-value" },
  ]);
  // Session variables belong in the native shell policy, not in the app-server's environment.
  const construction = readLog("requests.jsonl").filter(request => request.method === method);
  expect(construction[0].params.config["shell_environment_policy.set.SYNTHETIC_SESSION_VALUE"]).toBe("session-value");
});

it("reuses stable environments and resumes the same thread for additions, rotations and removals", async () => {
  threads.add("env-rotation");
  const base = { ZCC_THREAD_ID: "env-rotation", SYNTHETIC_TOKEN: "before" };
  harness.sendRequest(1, "thread/start", { threadId: "env-rotation", cwd: dir, instructionMode: "append", options: { ...options, envVars: base } });
  const start = await harness.waitForResponse(1);
  expect(start.error).toBeUndefined();
  const providerThreadId = (start.result as { providerThreadId: string }).providerThreadId;
  const envs = [
    { SYNTHETIC_TOKEN: "before", ZCC_THREAD_ID: "env-rotation" },
    undefined,
    {},
    { ...base, SYNTHETIC_TOKEN: "after" },
    { ...base, SYNTHETIC_TOKEN: "after", SYNTHETIC_EXTRA: "added" },
    { ZCC_THREAD_ID: "env-rotation" },
    { ZCC_THREAD_ID: "env-rotation", CODEX_HOME: join(dir, "moved-home") },
  ];
  for (const [index, envVars] of envs.entries()) {
    harness.sendRequest(index + 2, "turn/start", { threadId: "env-rotation", providerThreadId,
      clientRequestId: "creq_23456789ab", input: [{ type: "text", text: "hello", mentions: [] }], options: { ...options, envVars },
    });
    expect((await harness.waitForResponse(index + 2)).error).toBeUndefined();
    expect(readLog("requests.jsonl").filter(request => request.method === "thread/resume")).toHaveLength(Math.max(0, index - 2));
  }
  const resumes = readLog("requests.jsonl").filter(request => request.method === "thread/resume");
  expect(resumes.every(request => request.params.threadId === providerThreadId)).toBe(true);
  const shell = resumes.at(-2)!.params.config;
  expect(shell).not.toHaveProperty(["shell_environment_policy.set.SYNTHETIC_TOKEN"]);
  expect(shell).not.toHaveProperty(["shell_environment_policy.set.SYNTHETIC_EXTRA"]);
  expect(readLog("launches.jsonl").at(-1)!.home).toBe(join(dir, "moved-home"));
  expect(JSON.stringify(harness.messages.filter(message => message.method === "session/replaced"))).not.toContain("SYNTHETIC_TOKEN");
});
