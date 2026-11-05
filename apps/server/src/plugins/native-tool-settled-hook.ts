import { createHash } from 'node:crypto';
import {
  NATIVE_TOOL_SETTLED_OUTPUT_MAX_CHARS,
  type NativeToolSettledMainRequest
} from '@zana-ai/zcc-contracts/runtime';
import type { ToolSettledState } from '@zana-ai/zcc-domain';
import type { NativeToolPolicySession } from './native-tool-hook.js';

/** Remembers when a policy-approved call began so the settled event can report a duration. */
export interface ToolStartTracker {
  started(invocationId: string, at?: number): void;
  /** Milliseconds since `started`, consuming the entry; 0 when unknown (evicted or never seen). */
  take(invocationId: string, at?: number): number;
}

/** Bounded, in-memory only: an unmatched start is evicted oldest-first. */
export function createToolStartTracker(max = 4_096): ToolStartTracker {
  const starts = new Map<string, number>();
  return {
    started(invocationId, at = Date.now()) {
      starts.delete(invocationId);
      starts.set(invocationId, at);
      while (starts.size > max) starts.delete(starts.keys().next().value as string);
    },
    take(invocationId, at = Date.now()) {
      const began = starts.get(invocationId);
      if (began === undefined) return 0;
      starts.delete(invocationId);
      return Math.max(0, at - began);
    }
  };
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Raw output text of a provider tool response, bounded; strings, then the usual stdout/stderr/output/content fields. */
export function toolResponseText(response: unknown, maxChars: number): string {
  const parts: string[] = [];
  let used = 0;
  const push = (text: string) => {
    if (used >= maxChars || text.length === 0) return;
    const next = text.slice(0, maxChars - used);
    parts.push(next);
    used += next.length;
  };
  const visit = (value: unknown, depth: number): void => {
    if (depth > 4 || used >= maxChars) return;
    if (typeof value === 'string') return push(value);
    if (Array.isArray(value)) return value.slice(0, 64).forEach((entry) => visit(entry, depth + 1));
    if (!isObject(value)) return;
    for (const key of ['stdout', 'stderr', 'output', 'aggregated_output', 'formatted_output', 'content', 'text', 'result', 'error']) {
      if (key in value) visit(value[key], depth + 1);
    }
  };
  visit(response, 0);
  if (parts.length > 0) return parts.join('\n');
  try {
    const json = JSON.stringify(response);
    return typeof json === 'string' ? json.slice(0, maxChars) : '';
  } catch {
    return '';
  }
}

/** The metadata a PostToolUse / PostToolUseFailure body yields beyond the call's identity. */
export interface ParsedToolSettledBody {
  state: ToolSettledState;
  exitCode?: number;
  outputBytes?: number;
  output?: string;
}

function numberField(record: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isInteger(value)) return value;
  }
  return undefined;
}

/**
 * Outcome of one post-tool event. A `PostToolUseFailure` event, an `is_error`
 * response, or a non-zero exit is `failed`; an interrupt is `cancelled`. An
 * unparseable body yields null (the event is dropped).
 */
export function parseToolSettledBody(body: string, maxOutputChars: number): ParsedToolSettledBody | null {
  let event: unknown;
  try {
    event = JSON.parse(body);
  } catch {
    return null;
  }
  if (!isObject(event)) return null;
  const response = event.tool_response;
  const record = isObject(response) ? response : {};
  const metadata = isObject(record.metadata) ? record.metadata : {};
  const exitCode = numberField(record, 'exit_code', 'exitCode') ?? numberField(metadata, 'exit_code', 'exitCode');
  const cancelled = event.is_interrupt === true || record.interrupted === true;
  const failed = event.hook_event_name === 'PostToolUseFailure' || typeof event.error === 'string'
    || record.is_error === true || (exitCode !== undefined && exitCode !== 0);
  const output = toolResponseText(response ?? event.error, maxOutputChars);
  return {
    state: cancelled ? 'cancelled' : failed ? 'failed' : 'succeeded',
    ...(exitCode !== undefined ? { exitCode } : {}),
    ...(output.length > 0 ? { outputBytes: Buffer.byteLength(output, 'utf8'), output } : {})
  };
}

export interface NativeToolSettledHookDeps {
  /** Main's live PTY record for the URL's session, or null. */
  getSession(sessionId: string): NativeToolPolicySession | null;
  /** Hands the settled call to the plugin host; null when none is reachable. */
  sink(): ((request: NativeToolSettledMainRequest) => Promise<unknown>) | null;
  /** Start times the policy hook recorded for the same session. */
  starts: ToolStartTracker;
  /** Bounded diagnostics; never carries the tool input or output. */
  log?(message: string): void;
}

const validId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\x00-\x1f\x7f]/.test(value);

/**
 * Main's `/hook/toolsettled/:projectId/:sessionId` handler (OBL-011). Identity
 * comes from the LIVE session record, never the body, and `invocationId` uses
 * the same formula as the policy request (session, turn, tool-use id, tool name,
 * tool input), so the two correlate. Observational: any problem drops the event
 * and nothing is returned to the relay.
 */
export function createNativeToolSettledHook(deps: NativeToolSettledHookDeps) {
  return async (projectId: string, sessionId: string, body: string): Promise<void> => {
    const session = deps.getSession(sessionId);
    if (!session || session.projectId !== projectId) return;
    const sink = deps.sink();
    if (!sink) return;
    try {
      const event: unknown = JSON.parse(body);
      if (!isObject(event)) return;
      const turnId = event.turn_id ?? null;
      const toolUseId = event.tool_use_id;
      const toolName = event.tool_name;
      const input = event.tool_input ?? {};
      if ((turnId !== null && !validId(turnId)) || !validId(toolUseId) || !validId(toolName) || !isObject(input)) return;
      const invocationId = createHash('sha256')
        .update(JSON.stringify([session.id, turnId, toolUseId, toolName, input]))
        .digest('hex');
      const parsed = parseToolSettledBody(body, NATIVE_TOOL_SETTLED_OUTPUT_MAX_CHARS);
      if (!parsed) return;
      await sink({
        invocationId,
        sessionId: session.id,
        ...(session.threadId ? { threadId: session.threadId } : {}),
        projectId: session.projectId,
        profile: session.profile,
        toolName,
        state: parsed.state satisfies ToolSettledState,
        durationMs: deps.starts.take(invocationId),
        ...(parsed.exitCode !== undefined ? { exitCode: parsed.exitCode } : {}),
        ...(parsed.outputBytes !== undefined ? { outputBytes: parsed.outputBytes } : {}),
        ...(parsed.output !== undefined ? { output: parsed.output } : {})
      });
    } catch {
      deps.log?.(`settled event dropped for session ${session.id.slice(0, 8)}`);
    }
  };
}
