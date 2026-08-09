import type { LlmRunResult } from '../../shared/types.js';
import type { LlmProvider, LlmRunRequest } from './provider.js';
import { resolveModelAlias } from './model-aliases.js';

const OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_CHARS = 2_000;
const DEFAULT_MODEL = 'gpt-4o-mini';

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/**
 * OpenAI Chat Completions transport for the LLM micro-call seam. Twin of
 * {@link import('./claude-cli-provider.js').ClaudeCliProvider} but over HTTP: it
 * takes an API key (from `safeStorage`, see `voice/secrets.ts`) instead of
 * reusing a CLI login, and it populates {@link LlmRunResult.usage} from the
 * response's token accounting (the CLI leaves that undefined).
 *
 * Same "never throw" contract: every failure path (no key, HTTP error, network
 * error, timeout, abort) resolves to an `ok:false` result so the service and
 * callers stay branch-free. A Claude tier alias in `req.model` (haiku/sonnet)
 * is mapped to a concrete OpenAI id via {@link resolveModelAlias} — the built-in
 * prompts speak Claude aliases.
 */
export class OpenAiProvider implements LlmProvider {
  readonly id = 'openai' as const;

  constructor(private readonly getApiKey: () => string | null) {}

  /** Usable only when an OpenAI API key is stored (else every run() is ok:false). */
  isConfigured(): boolean {
    return !!this.getApiKey();
  }

  async run(req: LlmRunRequest): Promise<LlmRunResult> {
    const startedAt = Date.now();
    const timeoutMs = req.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxOutputChars = req.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS;
    const model = resolveModelAlias(this.id, req.model) ?? DEFAULT_MODEL;

    const fail = (error: string): LlmRunResult => ({
      ok: false,
      text: '',
      error,
      provider: this.id,
      model,
      ms: Date.now() - startedAt
    });

    const apiKey = this.getApiKey();
    if (!apiKey) return fail('no OpenAI API key configured');

    // Already-cancelled before we spend anything: bail without a request.
    if (req.signal?.aborted) return fail('aborted');

    // Own timeout controller, chained to the caller's signal so either aborts.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = (): void => controller.abort();
    req.signal?.addEventListener('abort', onAbort);

    try {
      const messages: Array<{ role: string; content: string }> = [];
      if (req.system.trim()) messages.push({ role: 'system', content: req.system });
      messages.push({ role: 'user', content: req.user });

      const res = await fetch(OPENAI_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ model, messages }),
        signal: controller.signal
      });

      if (!res.ok) {
        const errorText = await res.text().catch(() => '');
        return fail(`OpenAI error ${res.status}: ${errorText.slice(0, 200)}`);
      }

      const data = (await res.json()) as ChatCompletionResponse;
      const text = (data.choices?.[0]?.message?.content ?? '').trim().slice(0, maxOutputChars);
      const usage =
        data.usage?.prompt_tokens !== undefined || data.usage?.completion_tokens !== undefined
          ? { inputTokens: data.usage?.prompt_tokens, outputTokens: data.usage?.completion_tokens }
          : undefined;
      return {
        ok: true,
        text,
        provider: this.id,
        model,
        ms: Date.now() - startedAt,
        usage
      };
    } catch (err) {
      // An abort (caller signal or our timeout) surfaces as AbortError. Report
      // the timeout distinctly so a slow endpoint is diagnosable.
      if ((err as Error).name === 'AbortError') {
        return fail(req.signal?.aborted ? 'aborted' : `timed out after ${timeoutMs}ms`);
      }
      return fail(err instanceof Error ? err.message : String(err));
    } finally {
      clearTimeout(timer);
      req.signal?.removeEventListener('abort', onAbort);
    }
  }
}
