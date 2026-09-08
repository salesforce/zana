import type {
  CodexInferenceCompleteCommand,
  CodexInferenceCompleteResult
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

const CODEX_RESPONSES_URL = 'https://chatgpt.com/backend-api/codex/responses';
const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const SSE_RESPONSE_MAX_BYTES = 2 * 1024 * 1024;
const SSE_EVENT_MAX_CHARS = 1024 * 1024;
const ERROR_TEXT_MAX_BYTES = 4 * 1024;

export interface InferenceCompleteDeps extends CodexAuthReadOptions {
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

function jsonArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
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
  headers.set('OpenAI-Beta', 'responses=experimental');
  headers.set('Accept', 'text/event-stream');
  headers.set('Content-Type', 'application/json');
  if (auth.isFedrampAccount) headers.set('X-OpenAI-Fedramp', 'true');
  return headers;
}

function createOpenAiHeaders(auth: CodexOpenAiApiKeyCredentials): Headers {
  const headers = new Headers();
  headers.set('Authorization', `Bearer ${auth.apiKey}`);
  headers.set('User-Agent', 'zcc-host-daemon');
  headers.set('Accept', 'text/event-stream');
  headers.set('Content-Type', 'application/json');
  return headers;
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

function withStrictObjectSchemas(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => withStrictObjectSchemas(item));
  const object = jsonObject(value);
  if (!object) return value;
  const normalized: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(object)) {
    normalized[key] = withStrictObjectSchemas(child);
  }
  if (normalized.type === 'object' && normalized.additionalProperties === undefined) {
    normalized.additionalProperties = false;
  }
  if (normalized.type === 'object') {
    normalized.required = Object.keys(jsonObject(normalized.properties) ?? {});
  }
  return normalized;
}

function buildCodexResponsesRequest(command: CodexInferenceCompleteCommand): Record<string, unknown> {
  return {
    model: command.model,
    instructions: 'Follow the user prompt and respond with structured JSON that matches the requested schema.',
    reasoning: { effort: command.reasoningEffort },
    store: false,
    stream: true,
    input: [{
      role: 'user',
      content: [{ type: 'input_text', text: command.prompt }]
    }],
    text: {
      format: {
        type: 'json_schema',
        name: 'result',
        strict: true,
        schema: withStrictObjectSchemas(command.outputSchema)
      }
    }
  };
}

function getCodexResponseText(response: Record<string, unknown>): string | null {
  const output = jsonArray(response.output);
  if (!output) return null;
  for (const outputItem of output) {
    const item = jsonObject(outputItem);
    const content = item ? jsonArray(item.content) : null;
    if (!content) continue;
    for (const contentItem of content) {
      const contentObject = jsonObject(contentItem);
      if (!contentObject) continue;
      const type = optionalString(contentObject.type);
      const text = optionalString(contentObject.text) ?? optionalString(contentObject.output_text);
      if ((type === 'output_text' || type === 'text') && text !== null) return text;
    }
  }
  return null;
}

function extractTextFromSseEvent(event: Record<string, unknown>): { failure: string | null; text: string } {
  const type = optionalString(event.type);
  if (type === 'error') {
    return { failure: optionalString(event.message) ?? optionalString(event.code) ?? 'Codex response failed', text: '' };
  }
  if (type === 'response.failed') {
    const response = event.response ? jsonObject(event.response) : null;
    const error = response?.error ? jsonObject(response.error) : null;
    return {
      failure: optionalString(error?.message) ?? optionalString(error?.code) ?? 'Codex response failed',
      text: ''
    };
  }
  if (type === 'response.output_text.delta') {
    return { failure: null, text: optionalString(event.delta) ?? '' };
  }
  if (type === 'response.completed' || type === 'response.done') {
    const response = event.response ? jsonObject(event.response) : null;
    return { failure: null, text: response ? getCodexResponseText(response) ?? '' : '' };
  }
  return { failure: null, text: '' };
}

async function readChunkWithTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  deadline: Deadline,
  now: () => number
): Promise<ReadableStreamReadResult<Uint8Array>> {
  const timeoutMs = remainingMs(deadline, now);
  return Promise.race([
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
}

async function readResponseTextFromSse(
  response: Response,
  deadline: Deadline,
  now: () => number
): Promise<string> {
  if (!response.body) {
    throw new HostCommandError('codex_response_invalid', 'Codex response did not include a response body.');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let deltaText = '';
  let finalText: string | null = null;
  let totalBytes = 0;
  try {
    while (true) {
      const chunk = await readChunkWithTimeout(reader, deadline, now);
      if (chunk.done) break;
      totalBytes += chunk.value.byteLength;
      if (totalBytes > SSE_RESPONSE_MAX_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new HostCommandError('codex_response_too_large', 'Codex response exceeded the maximum supported size.');
      }
      buffer += decoder.decode(chunk.value, { stream: true });
      if (buffer.length > SSE_EVENT_MAX_CHARS) {
        throw new HostCommandError('codex_response_too_large', 'Codex response exceeded the maximum supported size.');
      }
      let index = buffer.indexOf('\n\n');
      while (index !== -1) {
        const block = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        const eventData = block
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim())
          .join('\n')
          .trim();
        if (eventData && eventData !== '[DONE]') {
          let parsed: unknown;
          try {
            parsed = JSON.parse(eventData);
          } catch {
            throw new HostCommandError('codex_response_invalid', 'Codex SSE event was not valid JSON.');
          }
          const event = jsonObject(parsed);
          if (event) {
            const result = extractTextFromSseEvent(event);
            if (result.failure) {
              throw new HostCommandError('codex_request_failed', result.failure);
            }
            if (event.type === 'response.completed' || event.type === 'response.done') {
              finalText = result.text || finalText;
            } else {
              deltaText += result.text;
            }
          }
        }
        index = buffer.indexOf('\n\n');
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const text = finalText ?? deltaText;
  if (!text) {
    throw new HostCommandError('codex_response_invalid', 'Codex response did not include structured output text.');
  }
  return text;
}

function parseStructuredResult(rawText: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new HostCommandError('codex_response_invalid', 'Codex structured output was not valid JSON.');
  }
  const object = jsonObject(parsed);
  if (!object) {
    throw new HostCommandError('codex_response_invalid', 'Codex structured output was not a JSON object.');
  }
  return object;
}

function isCloudflareChallenge(response: Response): boolean {
  return response.status === 403 && response.headers.get('cf-mitigated')?.toLowerCase() === 'challenge';
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

async function fetchResponses(
  command: CodexInferenceCompleteCommand,
  auth: CodexAuthCredentials,
  body: string,
  fetchImpl: typeof fetch,
  deadline: Deadline,
  now: () => number
): Promise<Response> {
  if (auth.type === 'chatgpt') {
    return runFetch(fetchImpl, deadline, now, (signal) =>
      fetchChatGpt(fetchImpl, CODEX_RESPONSES_URL, (cloudflare) => {
        const headers = createChatGptHeaders(auth);
        for (const [key, value] of cloudflare) headers.set(key, value);
        return { method: 'POST', headers, body, signal };
      })
    );
  }
  return runFetch(fetchImpl, deadline, now, (signal) =>
    fetchImpl(OPENAI_RESPONSES_URL, {
      method: 'POST',
      headers: createOpenAiHeaders(auth),
      body,
      signal
    })
  );
}

async function readLimitedText(
  response: Response,
  deadline: Deadline,
  now: () => number,
  maxBytes: number
): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let total = 0;
  try {
    while (true) {
      const chunk = await readChunkWithTimeout(reader, deadline, now);
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > maxBytes) {
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

export async function completeCodexInference(
  command: CodexInferenceCompleteCommand,
  deps: InferenceCompleteDeps = {}
): Promise<CodexInferenceCompleteResult> {
  const now = deps.now ?? (() => performance.now());
  const fetchImpl = deps.fetchImpl ?? fetch;
  const auth = await resolveVoiceAuth(deps);
  const deadline = createDeadline(command.timeoutMs, now);
  const body = JSON.stringify(buildCodexResponsesRequest(command));
  const response = await fetchResponses(command, auth, body, fetchImpl, deadline, now);
  if (!response.ok) {
    const raw = await readLimitedText(response, deadline, now, ERROR_TEXT_MAX_BYTES).catch(() => '');
    let providerMessage: string | null = null;
    try {
      providerMessage = extractJsonErrorMessage(JSON.parse(raw)) ?? (raw.replace(/\s+/g, ' ').trim() || null);
    } catch {
      providerMessage = raw.replace(/\s+/g, ' ').trim() || null;
    }
    const details = providerMessage ? `: ${providerMessage}` : '';
    throw new HostCommandError(
      errorCodeForStatus(response.status),
      `Codex inference request failed with HTTP ${response.status}${details}`
    );
  }
  const rawText = await readResponseTextFromSse(response, deadline, now);
  return {
    model: command.model,
    value: parseStructuredResult(rawText)
  };
}
