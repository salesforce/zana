import type { CodexVoiceTranscribeResult } from '@zana-ai/zcc-contracts/host-rpc';
import { AmbiguousHostError, HostUnavailableError } from '../../http/host-hub.js';
import type { ProductHttpContext } from '../../http/product-context.js';
import { VOICE_TRANSCRIPTION_MAX_BYTES } from '../../http/multipart-voice.js';

export const DEFAULT_VOICE_MODEL = 'gpt-transcribe';
export const VOICE_COMMAND_TIMEOUT_MS = 10_000;
export const VOICE_RPC_TIMEOUT_MS = 25_000;
export const CODEX_VOICE_LOGIN_MESSAGE =
  'Sign in with Codex (`codex login`) or set OPENAI_API_KEY.';

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
  if (code === 'codex_request_timeout') return 504;
  if (code === 'codex_rate_limited' || code === 'codex_service_unavailable') return 503;
  return 502;
}

export function voiceTranscriptionEnabled(ctx: ProductHttpContext): boolean {
  return ctx.hostHub.connectedHostIds().length > 0;
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
  const model = ctx.config.getConfig().voiceModel?.trim() || DEFAULT_VOICE_MODEL;
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
