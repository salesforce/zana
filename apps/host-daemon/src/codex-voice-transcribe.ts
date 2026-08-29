import type {
  CodexVoiceTranscribeCommand,
  CodexVoiceTranscribeResult
} from '@zana-ai/zcc-contracts/host-rpc';
import {
  getChatGptCloudflareCookieHeader,
  storeChatGptCloudflareCookies
} from './chatgpt-cloudflare-cookies.js';
import {
  resolveVoiceAuth,
  type CodexAuthCredentials,
  type CodexAuthReadOptions,
  type CodexChatGptAuthCredentials,
  type CodexOpenAiApiKeyCredentials
} from './codex-auth.js';
import { HostCommandError } from './host-command-error.js';

export const VOICE_TRANSCRIPTION_MAX_BYTES = 25 * 1024 * 1024;
const CHATGPT_TRANSCRIBE_URL = 'https://chatgpt.com/backend-api/transcribe';
const OPENAI_TRANSCRIBE_URL = 'https://api.openai.com/v1/audio/transcriptions';
const TRANSCRIPTION_RESPONSE_MAX_BYTES = 1024 * 1024;
const ERROR_TEXT_MAX_BYTES = 4 * 1024;

export interface VoiceTranscribeDeps extends CodexAuthReadOptions {
  fetchImpl?: typeof fetch;
  now?: () => number;
}

interface Deadline {
  expiresAt: number;
  timeoutMs: number;
}

function jsonObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function createDeadline(timeoutMs: number, now: () => number): Deadline {
  return { expiresAt: now() + timeoutMs, timeoutMs };
}

function remainingMs(deadline: Deadline, now: () => number): number {
  const remaining = Math.ceil(deadline.expiresAt - now());
  if (remaining <= 0) {
    throw new HostCommandError(
      'codex_request_timeout',
      `Codex request timed out after ${deadline.timeoutMs}ms`
    );
  }
  return remaining;
}

function createChatGptHeaders(auth: CodexChatGptAuthCredentials): Headers {
  const headers = new Headers();
  headers.set('Authorization', `Bearer ${auth.accessToken}`);
  headers.set('chatgpt-account-id', auth.accountId);
  headers.set('originator', 'zcc');
  headers.set('User-Agent', 'zcc-host-daemon');
  if (auth.isFedrampAccount) headers.set('X-OpenAI-Fedramp', 'true');
  return headers;
}

function createOpenAiHeaders(auth: CodexOpenAiApiKeyCredentials): Headers {
  const headers = new Headers();
  headers.set('Authorization', `Bearer ${auth.apiKey}`);
  headers.set('User-Agent', 'zcc-host-daemon');
  return headers;
}

function decodeAudio(command: CodexVoiceTranscribeCommand): Buffer {
  const audio = Buffer.from(command.audioBase64, 'base64');
  if (audio.byteLength === 0) {
    throw new HostCommandError('invalid_request', 'Audio file must not be empty');
  }
  if (audio.byteLength > VOICE_TRANSCRIPTION_MAX_BYTES) {
    throw new HostCommandError('invalid_request', 'Audio file exceeds 25MB limit');
  }
  return audio;
}

function buildFormData(command: CodexVoiceTranscribeCommand, audio: Buffer): FormData {
  const form = new FormData();
  form.set('file', new Blob([new Uint8Array(audio)], { type: command.mimeType }), command.filename);
  form.set('model', command.model);
  if (command.prompt) form.set('prompt', command.prompt);
  return form;
}

function extractJsonErrorMessage(value: unknown): string | null {
  if (typeof value === 'string') {
    const normalized = value.replace(/\s+/g, ' ').trim();
    return normalized.length > 0 ? normalized : null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const message = extractJsonErrorMessage(item);
      if (message) return message;
    }
    return null;
  }
  const object = jsonObject(value);
  if (!object) return null;
  for (const key of ['message', 'detail', 'error']) {
    if (object[key] === undefined) continue;
    const message = extractJsonErrorMessage(object[key]);
    if (message) return message;
  }
  return null;
}

function errorCodeForStatus(status: number): string {
  if (status === 401) return 'codex_auth_failed';
  if (status === 429) return 'codex_rate_limited';
  if (status >= 500) return 'codex_service_unavailable';
  return 'codex_request_failed';
}

async function readLimitedText(
  response: Response,
  deadline: Deadline,
  now: () => number,
  maxBytes: number,
  overflow: 'throw' | 'truncate'
): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let total = 0;
  try {
    while (true) {
      const timeoutMs = remainingMs(deadline, now);
      const chunk = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          const timer = setTimeout(() => {
            reject(new HostCommandError(
              'codex_request_timeout',
              `Codex request timed out after ${deadline.timeoutMs}ms`
            ));
          }, timeoutMs);
          timer.unref();
        })
      ]);
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > maxBytes) {
        if (overflow === 'throw') {
          await reader.cancel().catch(() => undefined);
          throw new HostCommandError(
            'codex_response_too_large',
            'Codex response exceeded the maximum supported size.'
          );
        }
        const allowed = chunk.value.byteLength - (total - maxBytes);
        if (allowed > 0) {
          chunks.push(decoder.decode(chunk.value.slice(0, allowed), { stream: true }));
        }
        await reader.cancel().catch(() => undefined);
        break;
      }
      chunks.push(decoder.decode(chunk.value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join('');
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
}

async function runFetch(
  fetchImpl: typeof fetch,
  deadline: Deadline,
  now: () => number,
  work: (signal: AbortSignal) => Promise<Response>
): Promise<Response> {
  const abort = new AbortController();
  const timeoutMs = remainingMs(deadline, now);
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  timer.unref();
  try {
    return await work(abort.signal);
  } catch (error) {
    if (abort.signal.aborted) {
      throw new HostCommandError(
        'codex_request_timeout',
        `Codex request timed out after ${deadline.timeoutMs}ms`
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function isCloudflareChallenge(response: Response): boolean {
  return response.status === 403 && response.headers.get('cf-mitigated')?.toLowerCase() === 'challenge';
}

async function fetchChatGpt(
  fetchImpl: typeof fetch,
  url: string,
  init: (headers: Headers) => RequestInit
): Promise<Response> {
  const fetchOnce = async (): Promise<Response> => {
    const headers = new Headers();
    const cookie = getChatGptCloudflareCookieHeader(url);
    if (cookie) headers.set('Cookie', cookie);
    const response = await fetchImpl(url, init(headers));
    storeChatGptCloudflareCookies(url, response.headers);
    return response;
  };
  const response = await fetchOnce();
  return isCloudflareChallenge(response) ? fetchOnce() : response;
}

async function transcribeWithAuth(
  command: CodexVoiceTranscribeCommand,
  auth: CodexAuthCredentials,
  audio: Buffer,
  fetchImpl: typeof fetch,
  deadline: Deadline,
  now: () => number
): Promise<Response> {
  const form = buildFormData(command, audio);
  if (auth.type === 'chatgpt') {
    return runFetch(fetchImpl, deadline, now, (signal) =>
      fetchChatGpt(fetchImpl, CHATGPT_TRANSCRIBE_URL, (cloudflare) => {
        const headers = createChatGptHeaders(auth);
        for (const [key, value] of cloudflare) headers.set(key, value);
        return { method: 'POST', headers, body: form, signal };
      })
    );
  }
  return runFetch(fetchImpl, deadline, now, (signal) =>
    fetchImpl(OPENAI_TRANSCRIBE_URL, {
      method: 'POST',
      headers: createOpenAiHeaders(auth),
      body: form,
      signal
    })
  );
}

export async function transcribeCodexVoice(
  command: CodexVoiceTranscribeCommand,
  deps: VoiceTranscribeDeps = {}
): Promise<CodexVoiceTranscribeResult> {
  const now = deps.now ?? (() => performance.now());
  const fetchImpl = deps.fetchImpl ?? fetch;
  const audio = decodeAudio(command);
  const auth = await resolveVoiceAuth(deps);
  const deadline = createDeadline(command.timeoutMs, now);
  const response = await transcribeWithAuth(command, auth, audio, fetchImpl, deadline, now);
  if (!response.ok) {
    const raw = await readLimitedText(response, deadline, now, ERROR_TEXT_MAX_BYTES, 'truncate').catch(() => '');
    let providerMessage: string | null = null;
    try {
      providerMessage = extractJsonErrorMessage(JSON.parse(raw)) ?? (raw.replace(/\s+/g, ' ').trim() || null);
    } catch {
      providerMessage = raw.replace(/\s+/g, ' ').trim() || null;
    }
    const details = providerMessage ? `: ${providerMessage}` : '';
    throw new HostCommandError(
      errorCodeForStatus(response.status),
      `Codex transcription request failed with HTTP ${response.status}${details}`
    );
  }
  const rawText = await readLimitedText(
    response,
    deadline,
    now,
    TRANSCRIPTION_RESPONSE_MAX_BYTES,
    'throw'
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new HostCommandError('codex_response_invalid', 'Codex transcription response was not valid JSON.');
  }
  const text = optionalString(jsonObject(parsed)?.text);
  if (text === null) {
    throw new HostCommandError(
      'codex_response_invalid',
      'Codex transcription response did not include transcript text.'
    );
  }
  return { model: command.model, text };
}
