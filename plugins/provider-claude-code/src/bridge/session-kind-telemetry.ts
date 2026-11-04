import { appendFile, chmod, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type {
  ClaudeSessionAdmission,
  ClaudeSessionKind,
} from "./session-kind.js";

export const SESSION_KIND_TELEMETRY_MAX_BYTES = 10 * 1024 * 1024;

export interface ClaudeSessionKindTelemetry {
  event: "start" | "end";
  sessionKind: ClaudeSessionKind;
  admission: ClaudeSessionAdmission;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  durationMs: number | null;
  outcome: "completed" | "error" | "interrupted" | "unknown";
  retry: number | null;
  settingSources: readonly string[];
  isolatedConfig: boolean;
  pluginRootCount: number;
  dynamicToolCount: number;
  skillCatalogBytes: number | null;
}

function numberOrNull(value: number | null): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

/** Whitelist projection: only enums, booleans and bounded numbers ever reach disk. */
export function toTelemetryRecord(
  record: ClaudeSessionKindTelemetry,
): Record<string, unknown> {
  return {
    ts: new Date().toISOString(),
    event: record.event,
    sessionKind: record.sessionKind,
    admission: record.admission,
    inputTokens: numberOrNull(record.inputTokens),
    cachedInputTokens: numberOrNull(record.cachedInputTokens),
    durationMs: numberOrNull(record.durationMs),
    outcome: record.outcome,
    retry: numberOrNull(record.retry),
    settingSources: record.settingSources.filter(
      (source) => source === "user" || source === "project" || source === "local",
    ),
    isolatedConfig: record.isolatedConfig,
    pluginRootCount: Math.max(0, Math.floor(record.pluginRootCount)),
    dynamicToolCount: Math.max(0, Math.floor(record.dynamicToolCount)),
    skillCatalogBytes: numberOrNull(record.skillCatalogBytes),
  };
}

let writeQueue: Promise<unknown> = Promise.resolve();

/** Resolves once every telemetry write queued so far has settled. */
export function flushSessionKindTelemetry(): Promise<void> {
  return writeQueue.then(() => undefined);
}

async function appendRecord(
  dataDir: string,
  record: ClaudeSessionKindTelemetry,
  maxBytes: number,
): Promise<boolean> {
  try {
    const dir = join(dataDir, "diagnostics");
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const file = join(dir, "claude-session-kind.jsonl");
    try {
      if ((await stat(file)).size >= maxBytes) return false;
    } catch {
      // first write
    }
    await appendFile(file, `${JSON.stringify(toTelemetryRecord(record))}\n`, {
      mode: 0o600,
    });
    await chmod(file, 0o600);
    return true;
  } catch {
    return false;
  }
}

/**
 * Append-only JSONL, `0600`, capped; stops appending once the cap is reached.
 * Async so the bridge event loop never blocks on disk; writes are serialized
 * so start/end records keep their order. Never rejects.
 */
export function writeSessionKindTelemetry(
  dataDir: string,
  record: ClaudeSessionKindTelemetry,
  maxBytes: number = SESSION_KIND_TELEMETRY_MAX_BYTES,
): Promise<boolean> {
  const result = writeQueue.then(() => appendRecord(dataDir, record, maxBytes));
  writeQueue = result;
  return result;
}
