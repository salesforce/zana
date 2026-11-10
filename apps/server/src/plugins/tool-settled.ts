import type { NativeToolSettledMainRequest } from '@zana-ai/zcc-contracts/runtime';
import type { ToolSettledContract } from '@zana-ai/zcc-domain';
import { capUtf8, redactPromptText } from './admission-prompt.js';
import { toolPolicyProviderId } from './native-tool-policy.js';
import type { PluginService } from './plugin-service.js';

/** Upper bound, in UTF-8 bytes, of the redacted `outputPreview` a plugin with `zcc.toolResults: 'preview'` receives. */
export const TOOL_SETTLED_PREVIEW_MAX_BYTES = 4 * 1024;

/** Bound on the text redaction scans, so a huge output never costs unbounded regex time. */
const PREVIEW_SCAN_MAX_CHARS = TOOL_SETTLED_PREVIEW_MAX_BYTES * 4;

/**
 * What a transport hands core for one settled call: identity and metadata plus
 * the raw output text (already length-bounded by the transport). Core is the
 * only place the text is redacted and capped, and the only place the decision
 * to include it is made.
 */
export type ToolSettledIntake = Omit<ToolSettledContract, 'outputPreview'> & { output?: string };

/** Redact, then cap: the only shape of tool output a plugin ever receives. */
export function buildToolOutputPreview(output: string): string {
  const scanned = output.length > PREVIEW_SCAN_MAX_CHARS ? output.slice(0, PREVIEW_SCAN_MAX_CHARS) : output;
  return capUtf8(redactPromptText(scanned), TOOL_SETTLED_PREVIEW_MAX_BYTES).text;
}

/**
 * The event one plugin receives. `includePreview` is that plugin's own
 * `zcc.toolResults === 'preview'` as read at its activation; without it the raw
 * output never leaves this function. Never stored and never logged.
 */
export function finalizeToolSettled(intake: ToolSettledIntake, includePreview: boolean): ToolSettledContract {
  const { output, ...metadata } = intake;
  return {
    ...metadata,
    ...(includePreview && output !== undefined && output.length > 0 ? { outputPreview: buildToolOutputPreview(output) } : {})
  };
}

/**
 * Fan one settled call of a PTY Electron-main owns out to live plugins. Main
 * asserted the identity from its session record. Fire-and-forget from the
 * caller's view: the reply says only whether a plugin service took the event.
 */
export function emitMainOwnedToolSettled(
  plugins: Pick<PluginService, 'emitToolSettled'> | undefined,
  request: NativeToolSettledMainRequest
): { delivered: boolean } {
  if (!plugins) return { delivered: false };
  const { profile, output, ...rest } = request;
  void plugins
    .emitToolSettled({ ...rest, providerId: toolPolicyProviderId(profile), ...(output !== undefined ? { output } : {}) })
    .catch(() => console.error('[plugins] tool.settled delivery failed'));
  return { delivered: true };
}
