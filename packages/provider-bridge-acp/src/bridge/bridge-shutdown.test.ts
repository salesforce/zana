import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { captureBridgeJsonRpcOutput } from "@zana-ai/zcc-provider-bridge-protocol/testing";

const fixture = vi.hoisted(() => ({
  close: vi.fn<(...args: unknown[]) => void>(),
  kill: vi.fn(),
  listen: vi.fn(),
}));

vi.mock("node:net", async importOriginal => {
  const actual = await importOriginal<typeof import("node:net")>();
  return { ...actual, createServer: () => ({
    once: vi.fn(),
    listen: (_port: number, _host: string, ready: () => void) => { fixture.listen(); ready(); },
    address: () => ({ port: 45678 }),
    close: fixture.close,
  }) };
});
vi.mock("./agent-connection.js", async importOriginal => {
  const actual = await importOriginal<typeof import("./agent-connection.js")>();
  return { ...actual, createAcpAgentConnection: () => ({
    exited: false, kill: fixture.kill,
    request: ({ method }: { method: string }) => method === "initialize"
      ? Promise.resolve({ protocolVersion: 1, agentCapabilities: {}, authMethods: [] })
      : Promise.resolve({ sessionId: "shutdown-session" }),
  }) };
});

let output: ReturnType<typeof captureBridgeJsonRpcOutput>;
beforeEach(() => {
  vi.resetModules();
  fixture.close.mockReset();
  fixture.kill.mockReset();
  fixture.listen.mockReset();
  output = captureBridgeJsonRpcOutput();
});
afterEach(() => {
  output.restore();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function withDynamicServer() {
  const module = await import("./bridge.js");
  module.handleLine(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "thread/start", params: {
    threadId: "shutdown-fixture", cwd: process.cwd(), instructionMode: "append",
    options: { permissionMode: "full", permissionScope: "full", approvalReviewer: null, permissionEscalation: null,
      providerOptions: { acpLaunchSpec: { command: process.execPath, args: [], env: {}, displayName: "Fixture" } } },
    dynamicTools: [{ name: "fixture_tool", description: "Fixture", inputSchema: { type: "object" } }],
  } }));
  await vi.waitFor(() => expect(fixture.listen).toHaveBeenCalledOnce());
  await vi.waitFor(() => expect(output.messages.find(message => message.id === 1)?.result).toBeDefined());
  return module.experimental_providerBridge;
}

it("shares an idempotent shutdown across stdin close and both termination signals", async () => {
  fixture.close.mockImplementation(callback => (callback as () => void)());
  const bridge = await withDynamicServer();
  const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  vi.useFakeTimers();
  bridge.onSigterm!();
  bridge.onClose!();
  bridge.onSigint!();
  await vi.waitFor(() => expect(exit).toHaveBeenCalledExactlyOnceWith(0));
  expect(fixture.kill).toHaveBeenCalledOnce();
  expect(fixture.close).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it("exits cleanly even when releasing the server throws", async () => {
  fixture.close.mockImplementation(() => { throw new Error("fixture close failed"); });
  const bridge = await withDynamicServer();
  const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  vi.useFakeTimers();
  bridge.onClose!();
  await vi.waitFor(() => expect(exit).toHaveBeenCalledExactlyOnceWith(0));
  expect(vi.getTimerCount()).toBe(0);
});

it("bounds a stuck server close below the host forced-termination deadline", async () => {
  const bridge = await withDynamicServer();
  const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  vi.useFakeTimers();
  bridge.onSigint!();
  await vi.advanceTimersByTimeAsync(3999);
  expect(exit).not.toHaveBeenCalled();
  expect(fixture.close).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1);
  expect(exit).toHaveBeenCalledExactlyOnceWith(0);
  bridge.onClose!();
  expect(vi.getTimerCount()).toBe(0);
});

it("exits without a session or dynamic server", async () => {
  const bridge = (await import("./bridge.js")).experimental_providerBridge;
  const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  vi.useFakeTimers();
  bridge.onClose!();
  await vi.waitFor(() => expect(exit).toHaveBeenCalledExactlyOnceWith(0));
  expect(fixture.close).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
