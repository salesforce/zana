import type { LlmPromptEntry, LlmProviderId, LlmRunResult } from '@zana-ai/zcc-domain/llm';
import type { LlmProvider, LlmProviderMap } from './provider.js';

const DEFAULT_PROVIDER: LlmProviderId = 'claude-cli';
const MONITOR_PROVIDERS: ReadonlySet<LlmProviderId> = new Set(['openai', 'gemini']);

/**
 * Fill `{{var}}` placeholders in a template from a vars map. Unknown
 * placeholders are left as-is (so a missing var is visible, not silently
 * blank). Whitespace inside the braces is tolerated: `{{ prompt }}`. Pure.
 */
export function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (whole, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : whole
  );
}

/**
 * Provider-agnostic micro-call dispatcher. Turns an {@link LlmPromptEntry} +
 * caller vars into a provider request, runs it, and returns the result. The
 * registry/model knowledge lives here; providers only see primitives.
 *
 * Holds a small in-flight de-dupe keyed by a caller-supplied `dedupeKey` (e.g.
 * a session id) so two rapid triggers for the same target don't double-spawn —
 * the second await joins the first call's promise.
 */
export class LlmService {
  private readonly inFlight = new Map<string, Promise<LlmRunResult>>();

  constructor(private readonly providers: LlmProviderMap) {}

  /** Register or replace a provider after construction (e.g. config reload). */
  setProvider(provider: LlmProvider): void {
    this.providers.set(provider.id, provider);
  }

  /**
   * The ids of every registered provider that is usable right now (its
   * `isConfigured()` is true, or it omits the method — always-configured, like
   * claude-cli). Drives the Settings → Prompts picker so it offers only
   * providers that will actually succeed. Recomputed on read so it reflects a
   * key added/removed since boot (the picker refetches when opened).
   */
  availableProviders(): LlmProviderId[] {
    const out: LlmProviderId[] = [];
    for (const provider of this.providers.values()) {
      if (provider.isConfigured?.() ?? true) out.push(provider.id);
    }
    return out;
  }

  /**
   * Run a prompt entry with the given template vars. `dedupeKey`, when set,
   * coalesces concurrent identical calls. Never throws — a missing provider
   * resolves to an `ok:false` result.
   */
  run(
    entry: LlmPromptEntry,
    vars: Record<string, string>,
    dedupeKey?: string
  ): Promise<LlmRunResult> {
    if (dedupeKey) {
      const existing = this.inFlight.get(dedupeKey);
      if (existing) return existing;
    }

    const providerId = entry.provider ?? DEFAULT_PROVIDER;
    const provider = this.providers.get(providerId);
    if (!provider) {
      return Promise.resolve({
        ok: false,
        text: '',
        error: `no provider registered for '${providerId}'`,
        provider: providerId,
        model: entry.model,
        ms: 0
      });
    }

    const user = fillTemplate(entry.userTemplate, vars);
    const call = provider.run({
      system: entry.systemPrompt,
      user,
      model: entry.model,
      maxOutputChars: entry.maxOutputChars,
      timeoutMs: entry.timeoutMs
    });

    if (dedupeKey) {
      this.inFlight.set(dedupeKey, call);
      void call.finally(() => {
        // Only clear if still the same promise (a later call may have replaced it).
        if (this.inFlight.get(dedupeKey) === call) this.inFlight.delete(dedupeKey);
      });
    }

    return call;
  }

  /**
   * Dispatch monitor-only semantic work through an explicit HTTP provider. This
   * boundary prevents a prompt override or default-provider fallback from
   * launching a coding harness while observing another session.
   */
  runMonitor(
    entry: LlmPromptEntry,
    providerId: LlmProviderId | undefined,
    vars: Record<string, string>,
    dedupeKey?: string
  ): Promise<LlmRunResult> {
    if (!providerId || !MONITOR_PROVIDERS.has(providerId)) {
      return Promise.resolve({
        ok: false,
        text: '',
        error: 'no eligible monitor HTTP provider configured',
        provider: providerId ?? 'openai',
        ms: 0
      });
    }
    return this.run({ ...entry, provider: providerId }, vars, dedupeKey);
  }
}
