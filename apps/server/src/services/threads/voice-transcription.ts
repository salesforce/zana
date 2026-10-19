import type { CodexVoiceStatusResult, CodexVoiceTranscribeResult } from '@zana-ai/zcc-contracts/host-rpc';
import { AmbiguousHostError, HostUnavailableError } from '../../http/host-hub.js';
import type { ProductHttpContext } from '../../http/product-context.js';
import { VOICE_TRANSCRIPTION_MAX_BYTES } from '../../http/multipart-voice.js';

export const DEFAULT_VOICE_MODEL = 'gpt-transcribe';
// Keep within CodexVoiceTranscribeCommandSchema's cap, including older hosts.
export const VOICE_COMMAND_TIMEOUT_MS = 60_000;
export const VOICE_RPC_TIMEOUT_MS = 85_000;
export const CODEX_VOICE_LOGIN_MESSAGE =
  'Voice input needs a Codex login on the connected computer. Sign in there, then try again.';

export class VoiceTranscriptionError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'VoiceTranscriptionError';
  }
}

function hostErrorStatus(code: string): number {
  if (code === 'codex_auth_missing' || code === 'codex_auth_invalid' || code === 'codex_auth_failed' || code === 'not_configured') {
    return 501;
  }
  if (code === 'invalid_request') return 400;
  if (code === 'codex_keyring_unavailable') return 503;
  if (code === 'codex_request_timeout') return 504;
  if (code === 'codex_rate_limited' || code === 'codex_service_unavailable') return 503;
  return 502;
}

export const VOICE_STATUS_RPC_TIMEOUT_MS = 3_000;

export interface VoiceTranscriptionStatus {
  enabled: boolean;
  reason: 'disabled' | 'no_host' | 'ambiguous_host' | 'auth_missing' | null;
}

// Only a definite "no Codex login / key on the host" disables the mic. Any
// other outcome (older host without `codex.voice.status`, timeout, keyring
// mode we deliberately don't read) keeps it enabled so real errors surface on
// use with their precise message instead of a false "unavailable".
export async function voiceTranscriptionStatus(ctx: ProductHttpContext): Promise<VoiceTranscriptionStatus> {
  if (!ctx.config.getConfig().voiceInputEnabled) return { enabled: false, reason: 'disabled' };
  if (ctx.hostHub.connectedHostIds().length === 0) return { enabled: false, reason: 'no_host' };
  try {
    const result = await ctx.hostHub.callHostOnlineRpc<CodexVoiceStatusResult>({
      hostId: ctx.hostHub.resolveHostId(),
      timeoutMs: VOICE_STATUS_RPC_TIMEOUT_MS,
      command: { type: 'codex.voice.status' }
    });
    if (result.state === 'missing') return { enabled: false, reason: 'auth_missing' };
  } catch (error) {
    // Transcription would 409 too, so "enabled" would be a false promise.
    if (error instanceof AmbiguousHostError) return { enabled: false, reason: 'ambiguous_host' };
    // Otherwise fall through to enabled.
  }
  return { enabled: true, reason: null };
}

function hostErrorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    return String((error as { code: unknown }).code);
  }
  return 'provider_rpc_error';
}

function isCodexAuthErrorCode(code: string): boolean {
  return code === 'codex_auth_missing' || code === 'codex_auth_invalid' || code === 'codex_auth_failed';
}

export async function transcribeVoiceOnHost(
  ctx: ProductHttpContext,
  args: { bytes: Buffer; mimeType: string; filename: string; prompt?: string }
): Promise<string> {
  if (args.bytes.byteLength === 0) {
    throw new VoiceTranscriptionError(400, 'invalid_request', 'Audio file must not be empty');
  }
  if (args.bytes.byteLength > VOICE_TRANSCRIPTION_MAX_BYTES) {
    throw new VoiceTranscriptionError(400, 'invalid_request', 'Audio file exceeds 25MB limit');
  }
  const config = ctx.config.getConfig();
  if (!config.voiceInputEnabled) {
    throw new VoiceTranscriptionError(403, 'voice_disabled', 'Voice input is turned off in Settings → Experimental');
  }
  const model = config.voiceModel?.trim() || DEFAULT_VOICE_MODEL;
  try {
    const hostId = ctx.hostHub.resolveHostId();
    const result = await ctx.hostHub.callHostOnlineRpc<CodexVoiceTranscribeResult>({
      hostId,
      timeoutMs: VOICE_RPC_TIMEOUT_MS,
      command: {
        type: 'codex.voice.transcribe',
        model,
        audioBase64: args.bytes.toString('base64'),
        mimeType: args.mimeType || 'application/octet-stream',
        filename: args.filename || 'recording.webm',
        prompt: args.prompt?.trim() || null,
        timeoutMs: VOICE_COMMAND_TIMEOUT_MS
      }
    });
    return result.text;
  } catch (error) {
    if (error instanceof HostUnavailableError) {
      throw new VoiceTranscriptionError(503, error.code, error.message);
    }
    if (error instanceof AmbiguousHostError) {
      throw new VoiceTranscriptionError(409, error.code, error.message);
    }
    const code = hostErrorCode(error);
    const message = error instanceof Error ? error.message : String(error);
    if (isCodexAuthErrorCode(code)) {
      throw new VoiceTranscriptionError(501, code, CODEX_VOICE_LOGIN_MESSAGE);
    }
    throw new VoiceTranscriptionError(hostErrorStatus(code), code, message);
  }
}
