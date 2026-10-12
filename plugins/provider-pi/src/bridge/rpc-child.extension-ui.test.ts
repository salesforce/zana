import { expect, it, vi } from "vitest";
import { buildPiChildEnv, PiRpcChild, resolvePiLaunch } from "./rpc-child.js";

it("accepts existing Pi command overrides, with ZCC values taking precedence", () => {
  const legacy = { BB_PI_BRIDGE_COMMAND: "old-pi", BB_PI_BRIDGE_ARGS: '["old"]' };
  expect(resolvePiLaunch(legacy)).toEqual({ command: "old-pi", args: ["old"] });
  expect(resolvePiLaunch({ ...legacy, ZCC_PI_BRIDGE_COMMAND: "new-pi", ZCC_PI_BRIDGE_ARGS: '["new"]' })).toEqual({ command: "new-pi", args: ["new"] });
  expect(() => resolvePiLaunch({ ...legacy, ZCC_PI_BRIDGE_ARGS: '[1]' })).toThrow("ZCC_PI_BRIDGE_ARGS");
});

it("trusts the OS certificate store in the Pi child unless the env already decides", () => {
  vi.stubEnv("NODE_USE_SYSTEM_CA", undefined);
  expect(buildPiChildEnv({}).NODE_USE_SYSTEM_CA).toBe("1");
  vi.stubEnv("NODE_USE_SYSTEM_CA", "0");
  expect(buildPiChildEnv({}).NODE_USE_SYSTEM_CA).toBe("0");
  expect(buildPiChildEnv({ NODE_USE_SYSTEM_CA: "1" }).NODE_USE_SYSTEM_CA).toBe("1");
  vi.unstubAllEnvs();
});

it("leaves the OS certificate store alone when the setting is off", () => {
  vi.stubEnv("NODE_USE_SYSTEM_CA", undefined);
  const off = { trustSystemCertificates: false };
  expect(buildPiChildEnv({}, off)).not.toHaveProperty("NODE_USE_SYSTEM_CA");
  expect(buildPiChildEnv({}, { trustSystemCertificates: true }).NODE_USE_SYSTEM_CA).toBe("1");
  vi.stubEnv("NODE_USE_SYSTEM_CA", "1");
  expect(buildPiChildEnv({}, off).NODE_USE_SYSTEM_CA).toBe("1");
  vi.unstubAllEnvs();
});

it("passes the OS certificate store setting through to the spawned Pi process", async () => {
  vi.stubEnv("NODE_USE_SYSTEM_CA", undefined);
  vi.stubEnv("ZCC_PI_BRIDGE_COMMAND", process.execPath);
  vi.stubEnv(
    "ZCC_PI_BRIDGE_ARGS",
    JSON.stringify([
      "-e",
      "process.stdout.write(JSON.stringify({ type: 'probe_result', value: process.env.NODE_USE_SYSTEM_CA ?? null }) + '\\n');",
    ]),
  );
  const events: Record<string, unknown>[] = [];
  const child = new PiRpcChild({
    cwd: process.cwd(),
    env: buildPiChildEnv({}),
    args: [],
    recordThreadId: null,
    onEvent: (event) => events.push(event),
    onChannelMessage: () => undefined,
    onExit: () => undefined,
  });
  await child.waitForExit();
  expect(events.find((event) => event.type === "probe_result")).toMatchObject({ value: "1" });
  vi.unstubAllEnvs();
});

function childScript(script: string): { command: string; args: string[] } {
  return { command: process.execPath, args: ["-e", script] };
}

it("auto-cancels extension ui requests when no handler is installed", async () => {
  vi.stubEnv(
    "ZCC_PI_BRIDGE_COMMAND",
    process.execPath,
  );
  vi.stubEnv(
    "ZCC_PI_BRIDGE_ARGS",
    JSON.stringify([
      "-e",
      [
        "process.stdin.setEncoding('utf8');",
        "let input='';",
        "process.stdin.on('data', (chunk) => {",
        "  input += chunk;",
        "  const newline = input.indexOf('\\n');",
        "  if (newline < 0) return;",
        "  process.stdout.write(JSON.stringify({ type: 'probe_result', response: JSON.parse(input.slice(0, newline)) }) + '\\n');",
        "  process.exit();",
        "});",
        "process.stdout.write(JSON.stringify({ type: 'extension_ui_request', id: 'ui-1', method: 'select', title: 'Allow?', options: ['Allow'] }) + '\\n');",
      ].join("\n"),
    ]),
  );
  const events: Record<string, unknown>[] = [];
  const child = new PiRpcChild({
    cwd: process.cwd(),
    env: process.env,
    args: [],
    recordThreadId: null,
    onEvent: (event) => events.push(event),
    onChannelMessage: () => undefined,
    onExit: () => undefined,
  });
  await child.waitForExit();
  const probe = events.find((event) => event.type === "probe_result");
  expect(probe).toMatchObject({
    response: { type: "extension_ui_response", id: "ui-1", cancelled: true },
  });
  vi.unstubAllEnvs();
});

it("forwards extension ui requests to the installed handler", async () => {
  const forwarded: Record<string, unknown>[] = [];
  const script = [
    "process.stdout.write(JSON.stringify({ type: 'extension_ui_request', id: 'ui-2', method: 'confirm', title: 'Go?' }) + '\\n');",
    "setTimeout(() => process.exit(), 50);",
  ].join("\n");
  const { command, args } = childScript(script);
  vi.stubEnv("ZCC_PI_BRIDGE_COMMAND", command);
  vi.stubEnv("ZCC_PI_BRIDGE_ARGS", JSON.stringify(args));
  const child = new PiRpcChild({
    cwd: process.cwd(),
    env: process.env,
    args: [],
    recordThreadId: null,
    onEvent: () => undefined,
    onChannelMessage: () => undefined,
    onExit: () => undefined,
    onExtensionUiRequest: (request) => forwarded.push(request),
  });
  await child.waitForExit();
  expect(forwarded).toEqual([
    { type: "extension_ui_request", id: "ui-2", method: "confirm", title: "Go?" },
  ]);
  vi.unstubAllEnvs();
});

it("respondToExtensionUi writes the response line to pi stdin", async () => {
  vi.stubEnv("ZCC_PI_BRIDGE_COMMAND", process.execPath);
  vi.stubEnv(
    "ZCC_PI_BRIDGE_ARGS",
    JSON.stringify([
      "-e",
      [
        "process.stdin.setEncoding('utf8');",
        "let input='';",
        "process.stdin.on('data', (chunk) => {",
        "  input += chunk;",
        "  const newline = input.indexOf('\\n');",
        "  if (newline < 0) return;",
        "  process.stdout.write(JSON.stringify({ type: 'probe_result', response: JSON.parse(input.slice(0, newline)) }) + '\\n');",
        "  process.exit();",
        "});",
        "process.stdout.write(JSON.stringify({ type: 'extension_ui_request', id: 7, method: 'select', title: 'Allow?', options: ['Allow'] }) + '\\n');",
      ].join("\n"),
    ]),
  );
  const events: Record<string, unknown>[] = [];
  const child = new PiRpcChild({
    cwd: process.cwd(),
    env: process.env,
    args: [],
    recordThreadId: null,
    onEvent: (event) => events.push(event),
    onChannelMessage: () => undefined,
    onExit: () => undefined,
    onExtensionUiRequest: (request) => {
      child.respondToExtensionUi(request.id as string, { value: "Allow" });
    },
  });
  await child.waitForExit();
  const probe = events.find((event) => event.type === "probe_result");
  expect(probe).toMatchObject({
    response: { type: "extension_ui_response", id: 7, value: "Allow" },
  });
  vi.unstubAllEnvs();
});
