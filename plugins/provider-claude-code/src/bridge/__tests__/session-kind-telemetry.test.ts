import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type ClaudeSessionKindTelemetry,
  toTelemetryRecord,
  flushSessionKindTelemetry,
  writeSessionKindTelemetry,
} from "../session-kind-telemetry.js";

const base: ClaudeSessionKindTelemetry = {
  event: "start",
  sessionKind: "automated",
  admission: "applied",
  inputTokens: null,
  cachedInputTokens: null,
  durationMs: null,
  outcome: "unknown",
  retry: null,
  settingSources: [],
  isolatedConfig: true,
  pluginRootCount: 2,
  dynamicToolCount: 3,
  skillCatalogBytes: null,
};

describe("session-kind telemetry", () => {
  let dataDir: string;
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "zcc-telemetry-"));
  });
  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("writes a 0600 JSONL record with null tokens when usage is absent", async () => {
    expect(await writeSessionKindTelemetry(dataDir, base)).toBe(true);
    const file = join(dataDir, "diagnostics", "claude-session-kind.jsonl");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const record = JSON.parse(readFileSync(file, "utf8").trim());
    expect(record).toMatchObject({
      inputTokens: null,
      cachedInputTokens: null,
      sessionKind: "automated",
      pluginRootCount: 2,
    });
  });

  it("projects only whitelisted fields and scrubs invalid numbers and sources", () => {
    const polluted = {
      ...base,
      prompt: "secret prompt",
      env: { TOKEN: "x" },
      inputTokens: -5,
      durationMs: Number.NaN,
      pluginRootCount: 2.9,
      settingSources: ["user", "/Users/someone/.claude"],
    } as ClaudeSessionKindTelemetry;
    const record = toTelemetryRecord(polluted);
    expect(Object.keys(record)).not.toContain("prompt");
    expect(Object.keys(record)).not.toContain("env");
    expect(record["inputTokens"]).toBeNull();
    expect(record["durationMs"]).toBeNull();
    expect(record["pluginRootCount"]).toBe(2);
    expect(record["settingSources"]).toEqual(["user"]);
  });

  it("stops appending once the size cap is reached", async () => {
    expect(await writeSessionKindTelemetry(dataDir, base, 50)).toBe(true);
    expect(await writeSessionKindTelemetry(dataDir, base, 50)).toBe(false);
    const file = join(dataDir, "diagnostics", "claude-session-kind.jsonl");
    expect(readFileSync(file, "utf8").trim().split("\n")).toHaveLength(1);
  });

  it("never throws when the data dir is unwritable", async () => {
    expect(await writeSessionKindTelemetry("/dev/null/nope", base)).toBe(false);
  });
});
