// Opt-in live check: real `pi` + a local sf-pi checkout, driven through the
// bridge, with a scripted OpenAI-compatible model so no credentials are used.
//   PI_LIVE_SF_PI_DIR=~/zcc-workspace/sf-pi vitest run src/bridge/bridge.live-sf-pi.test.ts
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { handleLine } from "./bridge.js";
import { PI_BRIDGE_ARGS_ENV, PI_BRIDGE_COMMAND_ENV } from "./rpc-child.js";
import {
  FULL_PERMISSION_OPTIONS,
  type FakePiBridgeHarness,
  startFakePiBridge,
} from "./test-support.js";

const sfPiDir = process.env.PI_LIVE_SF_PI_DIR;
const piCommand = process.env.PI_LIVE_COMMAND ?? "pi";

function sse(res: import("node:http").ServerResponse, delta: object, finish: string): void {
  const base = { id: "c1", object: "chat.completion.chunk", created: 1, model: "mock-1" };
  res.writeHead(200, { "content-type": "text/event-stream" });
  res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: "assistant", ...delta }, finish_reason: null }] })}\n\n`);
  res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: finish }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })}\n\n`);
  res.end("data: [DONE]\n\n");
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => (part as { text?: string }).text ?? "").join("\n");
  return "";
}

// Asks for `bash` when the pending user input carries RUN_BASH<<cmd>>; echoes otherwise.
function startMockModel(): Promise<Server> {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const messages = (JSON.parse(body) as { messages: { role: string; content: unknown }[] }).messages;
      const last = messages[messages.length - 1]!;
      if (process.env.PI_LIVE_DEBUG) console.log("mock <-", last.role, textOf(last.content).slice(-200));
      if (last.role === "tool") {
        sse(res, { content: `TOOL_RESULT: ${textOf(last.content).slice(0, 400)}` }, "stop");
        return;
      }
      // sf-pi appends its routing block as a separate user message after the prompt.
      const lastAssistant = messages.map((m) => m.role).lastIndexOf("assistant");
      const pending = messages.slice(lastAssistant + 1).map((m) => textOf(m.content)).join("\n");
      const command = /RUN_BASH<<(.+?)>>/su.exec(pending)?.[1];
      if (command !== undefined) {
        sse(res, { tool_calls: [{ index: 0, id: `call_${Date.now()}`, type: "function", function: { name: "bash", arguments: JSON.stringify({ command }) } }] }, "tool_calls");
        return;
      }
      sse(res, { content: "plain reply" }, "stop");
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

interface Interaction {
  id: string | number;
  params: { payload: { title: string; data: { method: string; options?: string[]; message?: string } } };
}

describe.skipIf(sfPiDir === undefined)("live pi + sf-pi", () => {
  let server: Server;
  let agentDir: string;
  let harness: FakePiBridgeHarness;
  let nextId = 9000;

  beforeAll(async () => {
    server = await startMockModel();
    agentDir = mkdtempSync(join(tmpdir(), "pi-live-agent-"));
    writeFileSync(join(agentDir, "models.json"), JSON.stringify({
      providers: {
        mock: {
          baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
          api: "openai-completions",
          apiKey: "mock",
          compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
          models: [{ id: "mock-1", contextWindow: 128000 }],
        },
      },
    }));
    writeFileSync(join(agentDir, "settings.json"), JSON.stringify({
      packages: [sfPiDir], defaultProvider: "mock", defaultModel: "mock-1",
    }));
    harness = await startFakePiBridge({ prefix: "pi-live-sfpi-", initialize: true });
    vi.stubEnv(PI_BRIDGE_COMMAND_ENV, piCommand);
    vi.stubEnv(PI_BRIDGE_ARGS_ENV, "[]");
    vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
    // sf-pi's Salesforce libraries log under ~/.sf; keep the real home untouched.
    vi.stubEnv("HOME", join(agentDir, "home"));
    vi.stubEnv("SF_DISABLE_LOG_FILE", "true");
    mkdirSync(join(agentDir, "home"));
  }, 120_000);

  afterAll(async () => {
    await harness?.teardown();
    server?.close();
    rmSync(agentDir, { recursive: true, force: true });
  }, 120_000);

  async function runGuardedTurn(threadId: string, answer: string, target: string) {
    const before = harness.messages.length;
    const turnsBefore = harness.deltasOf(threadId).filter((d) => d.kind === "turn.boundary").length;
    const checkpointedBefore = harness.deltasOf(threadId).filter((d) => d.kind === "turn.boundary" && d.providerCheckpointId !== undefined).length;
    handleLine(JSON.stringify({
      jsonrpc: "2.0", id: (nextId += 1), method: "turn/start",
      params: {
        threadId, providerThreadId: threadId, clientRequestId: `creq_guardrun${"abcdefgh"[nextId % 8]}${"abcdefgh"[(nextId >> 3) % 8]}`,
        input: [{ type: "text", text: `RUN_BASH<<rm -rf ${target}>>`, mentions: [] }],
        options: FULL_PERMISSION_OPTIONS,
      },
    }));
    await harness.waitFor(
      () => harness.messages.slice(before).some((m) => m.method === "interaction/request"),
      "the guardrail interaction",
    ).catch((error: unknown) => {
      if (process.env.PI_LIVE_DEBUG) console.log(JSON.stringify(harness.messages.slice(before)).slice(0, 6000));
      throw error;
    });
    const interaction = harness.messages.slice(before).find((m) => m.method === "interaction/request") as unknown as Interaction;
    handleLine(JSON.stringify({ jsonrpc: "2.0", id: interaction.id, result: { kind: "request_answer", value: answer } }));
    await harness.waitFor(
      () => harness.deltasOf(threadId).filter((d) => d.kind === "turn.boundary").length > turnsBefore,
      "the turn to settle",
    );
    // Give a stray second boundary a chance to show up.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const deltas = harness.deltasOf(threadId);
    const text = deltas.filter((d) => d.kind === "item.textDelta").map((d) => String(d.text)).join("");
    // Only checkpointed boundaries count: the trailing unkeyed one from
    // pi/prompt/settled is a no-op once the turn has closed.
    const checkpointed = (list: Record<string, unknown>[]) =>
      list.filter((d) => d.kind === "turn.boundary" && d.providerCheckpointId !== undefined).length;
    const boundaries = checkpointed(deltas) - checkpointedBefore;
    if (process.env.PI_LIVE_DEBUG) {
      console.log(deltas.map((d) => d.kind === "unhandled" ? `unhandled:${JSON.stringify(d.raw).match(/"type":"(\w+)"/u)?.[1]}` : d.kind === "turn.boundary" ? `turn.boundary ${JSON.stringify(d)}` : String(d.kind)).join("\n"));
    }
    return { interaction, text, boundaries };
  }

  it("routes the sf-guardrail rm -rf confirmation to the host and honours Block, then Allow once", async () => {
    const threadId = "thr_live_guardrail";
    const target = join(harness.workspaceDir, "scratch");
    mkdirSync(target);
    const started = await harness.startThread(threadId);
    expect(started.error).toBeUndefined();

    const blocked = await runGuardedTurn(threadId, "Block", target);
    const { title, data } = blocked.interaction.params.payload;
    expect(data.message).toContain(`Subject:\n- rm -rf ${target}`);
    expect(title.length).toBeLessThanOrEqual(160);
    expect(title).not.toContain("\n");
    expect(data.method).toBe("select");
    expect(data.options).toEqual(["Allow once", "Allow for this session", "Block"]);
    expect(blocked.boundaries).toBe(1);
    expect(existsSync(target)).toBe(true);
    expect(blocked.text).toMatch(/TOOL_RESULT: .*block/isu);

    const allowed = await runGuardedTurn(threadId, "Allow once", target);
    expect(allowed.boundaries).toBe(1);
    expect(existsSync(target)).toBe(false);
    const allowedText = allowed.text.slice(blocked.text.length);
    expect(allowedText).toContain("TOOL_RESULT:");
    expect(allowedText).not.toMatch(/block/iu);
  }, 240_000);
});
