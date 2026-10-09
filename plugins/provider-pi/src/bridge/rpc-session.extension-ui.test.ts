import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { PI_BRIDGE_ARGS_ENV, PI_BRIDGE_COMMAND_ENV } from "./rpc-child.js";
import { PiRpcSession } from "./rpc-session.js";

it("auto-cancels extension dialogs in a helper session without a UI handler", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bb-pi-helper-ui-"));
  const log = join(dir, "responses.jsonl");
  const script = `
    const fs = require("node:fs");
    const input = require("node:readline").createInterface({ input: process.stdin });
    const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
    input.on("line", (line) => {
      const message = JSON.parse(line);
      if (message.type === "get_state") {
        send({ type: "response", id: message.id, success: true, data: {
          model: { provider: "test", id: "test" }, isStreaming: false, isCompacting: false,
        } });
      }
      if (message.type === "extension_ui_response") {
        fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(message) + "\\n");
        fs.writeSync(3, JSON.stringify({ kind: "ready" }) + "\\n");
      }
    });
    input.on("close", () => process.exit(0));
    send({ type: "extension_ui_request", id: "ui-helper", method: "confirm", title: "Startup confirmation", message: "Continue?" });
  `;
  vi.stubEnv(PI_BRIDGE_COMMAND_ENV, process.execPath);
  vi.stubEnv(PI_BRIDGE_ARGS_ENV, JSON.stringify(["-e", script, "--"]));
  vi.stubEnv("ZCC_PI_BRIDGE_READINESS_TIMEOUT_MS", "1000");
  const session = new PiRpcSession(
    {
      cwd: dir,
      sessionFilePath: join(dir, "session.jsonl"),
      sessionDir: dir,
      scratchDir: dir,
      extensionPath: join(dir, "extension.mjs"),
      recordThreadId: "thr_helper_ui",
      noSession: true,
    },
    async () => ({ content: "", isError: true }),
    () => undefined,
    () => undefined,
  );
  try {
    await session.start();
    expect(JSON.parse(readFileSync(log, "utf8"))).toEqual({
      type: "extension_ui_response",
      id: "ui-helper",
      cancelled: true,
    });
  } finally {
    try {
      await session.closeGracefully(1000);
    } finally {
      vi.unstubAllEnvs();
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

it("does not surface a dialog from a child discarded by an auth retry", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bb-pi-retired-ui-"));
  const counter = join(dir, "attempts");
  const script = `
    const fs = require("node:fs");
    const attempt = fs.existsSync(${JSON.stringify(counter)})
      ? Number(fs.readFileSync(${JSON.stringify(counter)}, "utf8")) + 1
      : 1;
    fs.writeFileSync(${JSON.stringify(counter)}, String(attempt));
    const input = require("node:readline").createInterface({ input: process.stdin });
    const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
    input.on("line", (line) => {
      const message = JSON.parse(line);
      if (message.type === "get_state") {
        send({ type: "response", id: message.id, success: true, data: {
          model: { provider: attempt === 1 ? "unknown" : "test", id: "test" },
          isStreaming: false, isCompacting: false,
        } });
        fs.writeSync(3, JSON.stringify({ kind: "ready" }) + "\\n");
      }
    });
    process.on("SIGTERM", () => {
      send({ type: "extension_ui_request", id: "ui-stale", method: "confirm", title: "Stale?" });
      setTimeout(() => process.exit(0), 50);
    });
    if (attempt > 1) input.on("close", () => process.exit(0));
  `;
  vi.stubEnv(PI_BRIDGE_COMMAND_ENV, process.execPath);
  vi.stubEnv(PI_BRIDGE_ARGS_ENV, JSON.stringify(["-e", script, "--"]));
  vi.stubEnv("ZCC_PI_BRIDGE_READINESS_TIMEOUT_MS", "1000");
  const onExtensionUiRequest = vi.fn();
  const session = new PiRpcSession(
    {
      cwd: dir,
      sessionFilePath: join(dir, "session.jsonl"),
      sessionDir: dir,
      scratchDir: dir,
      extensionPath: join(dir, "extension.mjs"),
      recordThreadId: "thr_retired_ui",
      noSession: true,
      onExtensionUiRequest,
    },
    async () => ({ content: "", isError: true }),
    () => undefined,
    () => undefined,
  );
  try {
    await session.start();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(readFileSync(counter, "utf8")).toBe("2");
    expect(onExtensionUiRequest).not.toHaveBeenCalled();
  } finally {
    try {
      await session.closeGracefully(1000);
    } finally {
      vi.unstubAllEnvs();
      rmSync(dir, { recursive: true, force: true });
    }
  }
});
