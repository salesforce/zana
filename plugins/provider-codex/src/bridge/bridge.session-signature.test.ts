import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { experimental_createBridgeJsonRpcTestHarness as createBridgeJsonRpcTestHarness } from "@zana-ai/zcc-plugin-sdk/provider-bridge/testing";
import { handleLine } from "./bridge.js";

const THREAD_ID = "thr_signature_1";

const fakeAppServerPath = fileURLToPath(
  new URL("./fake-codex-app-server.mjs", import.meta.url),
);

const sessionOptions = {
  permissionMode: "full",
  permissionScope: "full",
  approvalReviewer: null,
  permissionEscalation: null,
} as const;

const autoAskSessionOptions = {
  permissionMode: "auto",
  permissionScope: "workspace",
  approvalReviewer: "automatic",
  permissionEscalation: "ask",
} as const;

const autoDenySessionOptions = {
  ...autoAskSessionOptions,
  permissionEscalation: "deny",
} as const;

let harness: ReturnType<typeof createBridgeJsonRpcTestHarness>;
let workspaceDir: string;

beforeEach(() => {
  workspaceDir = mkdtempSync(join(tmpdir(), "bb-codex-signature-ws-"));
  vi.stubEnv("ZCC_CODEX_BRIDGE_APP_SERVER_COMMAND", process.execPath);
  vi.stubEnv(
    "ZCC_CODEX_BRIDGE_APP_SERVER_ARGS",
    JSON.stringify([fakeAppServerPath]),
  );
  harness = createBridgeJsonRpcTestHarness(handleLine);
});

afterEach(async () => {
  const cleanupId = 991_001;
  harness.sendRequest(cleanupId, "thread/stop", {
    threadId: THREAD_ID,
    providerThreadId: "signature-cleanup",
    intent: "release",
    activeTurnId: null,
  });
  await harness.waitForResponse(cleanupId).catch(() => undefined);
  harness.restore();
  vi.unstubAllEnvs();
  rmSync(workspaceDir, { recursive: true, force: true });
});

it("keeps the constructed session for a turn whose options carry no envVars", async () => {
  harness.sendRequest(1, "thread/start", {
    threadId: THREAD_ID,
    cwd: workspaceDir,
    instructionMode: "append",
    options: { ...sessionOptions, envVars: { PATH: "/usr/bin:/bin" } },
  });
  const started = await harness.waitForResponse(1);
  const providerThreadId = (started.result as { providerThreadId: string })
    .providerThreadId;

  harness.sendRequest(2, "turn/start", {
    threadId: THREAD_ID,
    providerThreadId,
    clientRequestId: "creq_signature2",
    input: [{ type: "text", text: "say hello", mentions: [] }],
    options: { ...sessionOptions },
  });
  const turn = await harness.waitForResponse(2);

  expect(turn.error).toBeUndefined();
  expect(
    harness.messages.filter((message) => message.method === "session/replaced"),
  ).toEqual([]);
}, 30_000);

it("keeps an auto-reviewed session when only escalation intent changes", async () => {
  harness.sendRequest(1, "thread/start", {
    threadId: THREAD_ID,
    cwd: workspaceDir,
    instructionMode: "append",
    options: autoAskSessionOptions,
  });
  const started = await harness.waitForResponse(1);
  const providerThreadId = (started.result as { providerThreadId: string })
    .providerThreadId;

  harness.sendRequest(2, "turn/start", {
    threadId: THREAD_ID,
    providerThreadId,
    clientRequestId: "creq_signature3",
    input: [{ type: "text", text: "say hello", mentions: [] }],
    options: autoDenySessionOptions,
  });
  const turn = await harness.waitForResponse(2);

  expect(turn.error).toBeUndefined();
  expect(
    harness.messages.filter((message) => message.method === "session/replaced"),
  ).toEqual([]);
}, 30_000);

it.each([
  { before: sessionOptions, after: autoAskSessionOptions, sandbox: 'workspaceWrite' },
  { before: autoAskSessionOptions, after: sessionOptions, sandbox: 'dangerFullAccess' }
])('refreshes $sandbox on follow-ups and steers without replacing the child', async ({ before, after, sandbox }) => {
  const requestLogPath = join(workspaceDir, 'requests.jsonl');
  const scriptPath = join(workspaceDir, 'script.json');
  writeFileSync(scriptPath, JSON.stringify({ requestLogPath }));
  vi.stubEnv('ZCC_CODEX_BRIDGE_APP_SERVER_ARGS', JSON.stringify([fakeAppServerPath, scriptPath]));
  const requests = () => readFileSync(requestLogPath, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  harness.sendRequest(1, 'thread/start', { threadId: THREAD_ID, cwd: workspaceDir, instructionMode: 'append', options: before });
  const started = await harness.waitForResponse(1);
  const providerThreadId = (started.result as { providerThreadId: string }).providerThreadId;
  harness.sendRequest(2, 'turn/start', { threadId: THREAD_ID, providerThreadId, clientRequestId: 'creq_signature2', input: [{ type: 'text', text: '/wait-for-interrupt' }], options: before });
  expect((await harness.waitForResponse(2)).error).toBeUndefined();
  await vi.waitFor(() => expect(harness.messages.some(message => JSON.stringify(message).includes('turn.open'))).toBe(true));
  harness.sendRequest(3, 'turn/steer', { threadId: THREAD_ID, providerThreadId, expectedTurnId: 'turn-fx-1', clientRequestId: 'creq_signature3', input: [{ type: 'text', text: 'apply new policy' }], options: after });
  expect((await harness.waitForResponse(3)).error).toBeUndefined();
  expect(requests().map(request => request.method)).toContain('turn/interrupt');
  expect(requests().filter(request => request.method === 'turn/start').at(-1).params.sandboxPolicy.type).toBe(sandbox);
  expect(harness.messages.filter(message => message.method === 'session/replaced')).toEqual([]);
  expect(requests().filter(request => request.method === 'initialize')).toHaveLength(1);
});

async function openInterruptibleTurn(script: Record<string, unknown> = {}) {
  const requestLogPath = join(workspaceDir, 'requests.jsonl');
  const scriptPath = join(workspaceDir, 'script.json');
  writeFileSync(scriptPath, JSON.stringify({ ...script, requestLogPath }));
  vi.stubEnv('ZCC_CODEX_BRIDGE_APP_SERVER_ARGS', JSON.stringify([fakeAppServerPath, scriptPath]));
  harness.sendRequest(1, 'thread/start', { threadId: THREAD_ID, cwd: workspaceDir, instructionMode: 'append', options: sessionOptions });
  const started = await harness.waitForResponse(1);
  expect(started.error).toBeUndefined();
  const providerThreadId = (started.result as { providerThreadId: string }).providerThreadId;
  harness.sendRequest(2, 'turn/start', {
    threadId: THREAD_ID, providerThreadId, clientRequestId: 'creq_signature2',
    input: [{ type: 'text', text: '/wait-for-interrupt' }], options: sessionOptions
  });
  expect((await harness.waitForResponse(2)).error).toBeUndefined();
  await vi.waitFor(() => expect(harness.messages.some(message => JSON.stringify(message).includes('turn.open'))).toBe(true));
  return {
    providerThreadId,
    requests: () => readFileSync(requestLogPath, 'utf8').trim().split('\n').map(line => JSON.parse(line))
  };
}

it('refuses changed permissions for a stale steer before interrupting any active work', async () => {
  const { providerThreadId, requests } = await openInterruptibleTurn();
  harness.sendRequest(3, 'turn/steer', {
    threadId: THREAD_ID, providerThreadId, expectedTurnId: 'already-settled-turn',
    clientRequestId: 'creq_signature3', input: [{ type: 'text', text: 'stale steer' }], options: autoAskSessionOptions
  });
  expect((await harness.waitForResponse(3)).error?.message).toContain('no longer active');
  expect(requests().filter(request => request.method === 'turn/interrupt')).toEqual([]);
  expect(requests().filter(request => request.method === 'turn/start')).toHaveLength(1);
});

it('restores the previous permission settings when a follow-up start is rejected', async () => {
  const { providerThreadId, requests } = await openInterruptibleTurn({ failTurnStartAt: 2 });
  harness.sendRequest(3, 'turn/start', {
    threadId: THREAD_ID, providerThreadId, clientRequestId: 'creq_signature3',
    input: [{ type: 'text', text: 'rejected follow-up' }], options: autoAskSessionOptions
  });
  expect((await harness.waitForResponse(3)).error?.message).toContain('Fixture rejected turn start');
  harness.sendRequest(4, 'turn/steer', {
    threadId: THREAD_ID, providerThreadId, expectedTurnId: 'turn-fx-1', clientRequestId: 'creq_signature4',
    input: [{ type: 'text', text: 'same-policy steer' }], options: sessionOptions
  });
  expect((await harness.waitForResponse(4)).error).toBeUndefined();
  expect(requests().filter(request => request.method === 'turn/interrupt')).toEqual([]);
  expect(requests().filter(request => request.method === 'turn/steer')).toHaveLength(1);
  expect(harness.messages.filter(message => message.method === 'session/replaced')).toEqual([]);
});

it('does not start work with new permissions until interruption actually settles', async () => {
  const { providerThreadId, requests } = await openInterruptibleTurn({ suppressInterruptSettlement: true });
  harness.sendRequest(3, 'turn/steer', {
    threadId: THREAD_ID, providerThreadId, expectedTurnId: 'turn-fx-1', clientRequestId: 'creq_signature3',
    input: [{ type: 'text', text: 'changed-policy steer' }], options: autoAskSessionOptions
  });
  expect((await harness.waitForResponse(3)).error?.message).toContain('did not stop the active turn');
  expect(requests().filter(request => request.method === 'turn/interrupt')).toHaveLength(1);
  expect(requests().filter(request => request.method === 'turn/start')).toHaveLength(1);
  expect(requests().filter(request => request.method === 'turn/steer')).toEqual([]);
}, 30_000);
