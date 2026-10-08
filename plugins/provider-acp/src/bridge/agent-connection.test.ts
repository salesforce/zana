import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createAcpAgentConnection, formatAcpLaunchFailure } from "./agent-connection.js";
import { createCodexAppServerConnection, type CodexAppServerConnection } from "../../../provider-codex/src/bridge/app-server-connection.js";

const spawnMock = vi.hoisted(() => vi.fn());
vi.mock("@zana-ai/zcc-plugin-sdk/provider-bridge", async (importOriginal) => ({
  ...await importOriginal<typeof import("@zana-ai/zcc-plugin-sdk/provider-bridge")>(), experimental_spawnPortablePipedProcess: spawnMock,
}));

function start(create: typeof createAcpAgentConnection | typeof createCodexAppServerConnection) {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(),
    kill: vi.fn(() => true), pid: 123,
  });
  spawnMock.mockReturnValue(child);
  const onNotification = vi.fn();
  const onRequest = vi.fn();
  const onExit = vi.fn();
  const connection = create({ command: "probe", args: [], cwd: "/tmp", env: {}, recordThreadId: null, onNotification, onRequest, onExit });
  const writes = vi.spyOn(child.stdin, "write");
  const receive = (message: unknown) => child.stdout.emit("data", Buffer.from(`${JSON.stringify(message)}\n`));
  return { child, connection, onNotification, onRequest, onExit, writes, receive };
}

beforeEach(() => { vi.useFakeTimers(); spawnMock.mockReset(); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe.each([
  ["ACP", createAcpAgentConnection], ["Codex", createCodexAppServerConnection],
] as const)("%s child resource bounds", (_name, create) => {
  it("reassembles large UTF-8 notifications and following messages", () => {
    const { child, onNotification, receive } = start(create);
    const text = "é🙂".repeat(48_000);
    const frame = Buffer.from(JSON.stringify({ method: "progress", params: text }) + "\n");
    for (let at = 0; at < frame.length; at += 3001) child.stdout.emit("data", frame.subarray(at, at + 3001));
    receive({ method: "next", params: "done" });
    expect(onNotification.mock.calls).toEqual([["progress", text], ["next", "done"]]);
    child.emit("close", 0, null);
  });

  it("caps stderr by bytes, drains exit-time output, and releases its pipes", () => {
    const { child, onExit } = start(create);
    for (let i = 0; i < 40; i += 1) child.stderr.emit("data", Buffer.alloc(256 * 1024, "e"));
    child.emit("exit", 7, null);
    expect(onExit).not.toHaveBeenCalled();
    child.stderr.emit("data", "late-error\n");
    child.emit("close", 7, null);
    const info = onExit.mock.calls[0][0];
    expect(Buffer.byteLength(info.stderrTail)).toBe(64 * 1024);
    expect(info.stderrTail.endsWith("late-error\n")).toBe(true);
    expect(info.code).toBe(7);
    expect(child.stdout.destroyed).toBe(true);
    expect(child.stderr.destroyed).toBe(true);
    child.emit("close", 7, null);
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("rejects pending work and kills an oversized frame without delivering subsequent frames", async () => {
    const { child, connection, onNotification, onExit } = start(create);
    const pending = connection.request({ method: "pending", params: {}, resultSchema: z.string() });
    const rejected = expect(pending).rejects.toThrow("stdout frame exceeded");
    child.stdout.emit("data", Buffer.alloc(64 * 1024 * 1024 + 1, "x"));
    child.stdout.emit("data", Buffer.from('\n{"method":"next","params":"discard"}\n'));
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    expect(onNotification).not.toHaveBeenCalled();
    await expect(connection.request({ method: "next", params: {}, resultSchema: z.string() })).rejects.toThrow("not running");
    child.emit("close", null, "SIGKILL");
    await rejected;
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("settles replies, validates result schemas, and reports provider errors", async () => {
    const { child, connection, receive } = start(create);
    const success = connection.request({ method: "ping", params: {}, resultSchema: z.string() });
    receive({ id: "1", result: "pong" });
    await expect(success).resolves.toBe("pong");
    const invalid = connection.request({ method: "invalid", params: {}, resultSchema: z.string() });
    receive({ id: 2, result: 3 });
    await expect(invalid).rejects.toThrow("unexpected invalid result");
    const failure = connection.request({ method: "failure", params: {}, resultSchema: z.string() });
    receive({ id: 3, error: { message: "provider error" } });
    await expect(failure).rejects.toThrow("provider error");
    const unnamed = connection.request({ method: "unnamed", params: {}, resultSchema: z.string() });
    receive({ id: 4, error: {} });
    await expect(unnamed).rejects.toThrow("error code unknown");
    child.emit("close", 0, null);
  });

  it("ignores malformed messages and answers each incoming request once", () => {
    const { child, connection, receive, onRequest, onNotification, writes } = start(create);
    child.stdout.emit("data", Buffer.from("\nnot-json\nnull\n[]\n1\n{}\n"));
    receive({ id: 100, result: "unknown" });
    expect(onNotification).not.toHaveBeenCalled();
    receive({ id: "incoming", method: "approval", params: {} });
    const responder = onRequest.mock.calls[0][2];
    responder.result(undefined);
    responder.result("duplicate");
    responder.error(1, "duplicate");
    expect(writes).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(writes.mock.calls[0][0]))).toMatchObject({ id: "incoming", result: null });
    receive({ id: 101, method: "approval", params: {} });
    const errorResponder = onRequest.mock.calls[1][2];
    errorResponder.error(3, "denied");
    errorResponder.result("duplicate");
    errorResponder.error(3, "duplicate");
    expect(writes).toHaveBeenCalledTimes(2);
    connection.notify("cancel", {});
    expect(writes).toHaveBeenCalledTimes(3);
    child.emit("close", 0, null);
    connection.notify("cancel", {});
    receive({ method: "late", params: {} });
    expect(writes).toHaveBeenCalledTimes(3);
    expect(onNotification).not.toHaveBeenCalled();
  });

  it("bounds wait for inherited pipes that do not close after process exit", async () => {
    const { child, connection, onExit } = start(create);
    const pending = connection.request({ method: "pending", params: {}, resultSchema: z.string() });
    const rejected = expect(pending).rejects.toThrow("exited");
    child.emit("exit", 1, null);
    await vi.advanceTimersByTimeAsync(1000);
    await rejected;
    expect(onExit).toHaveBeenCalledTimes(1);
    await connection.kill();
    expect(child.kill).not.toHaveBeenCalled();
  });

  it("settles failed spawns and disallows subsequent requests", async () => {
    const { child, connection, onExit } = start(create);
    const pending = connection.request({ method: "pending", params: {}, resultSchema: z.string() });
    const rejected = expect(pending).rejects.toThrow();
    child.emit("error", Object.assign(new Error("spawn probe ENOENT"), { code: "ENOENT" }));
    await rejected;
    await connection.kill();
    await expect(connection.request({ method: "later", params: {}, resultSchema: z.string() })).rejects.toThrow("not running");
    expect(onExit).toHaveBeenCalledTimes(1);
    child.emit("error", new Error("duplicate"));
    child.emit("exit", 1, null);
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});

describe("ACP child shutdown", () => {
  it("escalates once and waits for an unresponsive child's actual close", async () => {
    const { child, connection, onExit } = start(createAcpAgentConnection);
    const stopped = connection.kill();
    expect(connection.kill()).toBe(stopped);
    expect(child.kill.mock.calls).toEqual([["SIGTERM"]]);
    let resolved = false;
    void stopped.then(() => { resolved = true; });
    await vi.advanceTimersByTimeAsync(3999);
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(child.kill.mock.calls).toEqual([["SIGTERM"], ["SIGKILL"]]);
    child.emit("exit", null, "SIGKILL");
    expect(resolved).toBe(false);
    child.emit("close", null, "SIGKILL");
    await stopped;
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(connection.exited).toBe(true);
  });

  it("cancels escalation when a cooperative child closes", async () => {
    const { child, connection } = start(createAcpAgentConnection);
    const stopped = connection.kill();
    child.emit("close", 0, null);
    await stopped;
    await vi.advanceTimersByTimeAsync(5000);
    expect(child.kill.mock.calls).toEqual([["SIGTERM"]]);
  });
});

it("Codex request deadlines remove unanswered pending requests", async () => {
  const { child, connection } = start(createCodexAppServerConnection);
  const pending = (connection as CodexAppServerConnection).request({ method: "timeout", params: {}, resultSchema: z.string(), timeoutMs: 10 });
  const rejected = expect(pending).rejects.toThrow("did not answer timeout");
  await vi.advanceTimersByTimeAsync(10);
  await rejected;
  child.emit("close", 0, null);
});

describe("formatAcpLaunchFailure", () => {
  it("maps spawn ENOENT to a missing-on-this-machine message", () => {
    const missing = Object.assign(new Error("spawn opencode ENOENT"), {
      code: "ENOENT",
    });
    expect(formatAcpLaunchFailure("opencode", missing)).toBe(
      'OpenCode is not installed on this machine (command "opencode" was not found). Install it on this host, or pick another agent.',
    );
    expect(formatAcpLaunchFailure("opencode", new Error("exited 64"))).toBe(
      'Failed to launch ACP agent "opencode": exited 64',
    );
  });
});
