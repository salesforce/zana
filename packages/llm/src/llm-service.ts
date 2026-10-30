import type { LlmPromptEntry, LlmProviderId, LlmRunResult } from '@zana-ai/zcc-domain/llm';
import type { LlmProvider, LlmProviderMap } from './provider.js';
import { createHash } from 'node:crypto';

const DEFAULT_PROVIDER: LlmProviderId = 'claude-cli';

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
  private providerGeneration = 0;

  constructor(
    private readonly providers: LlmProviderMap,
    private readonly refreshProviderIdentity: () => void = () => {}
  ) {}

  /** Register or replace a provider after construction (e.g. config reload). */
  setProvider(provider: LlmProvider): void {
    this.providers.set(provider.id, provider);
    this.providerGeneration++;
  }

  /** Provider config changed. New work must not join an old-provider call. */
  invalidateProviderIdentity(): void {
    this.providerGeneration++;
    this.inFlight.clear();
  }

  /** Hash complete provider request identity; never expose prompt text in keys. */
  requestIdentity(entry: LlmPromptEntry, vars: Record<string, string>): string {
    this.refreshProviderIdentity();
    const provider = entry.provider ?? DEFAULT_PROVIDER;
    const payload = JSON.stringify({ generation: this.providerGeneration, provider, model: entry.model,
      system: entry.systemPrompt, user: fillTemplate(entry.userTemplate, vars),
      maxOutputChars: entry.maxOutputChars, timeoutMs: entry.timeoutMs });
    return createHash('sha256').update(payload).digest('hex');
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
    const identity = this.requestIdentity(entry, vars);
    const inflightKey = dedupeKey ? `${dedupeKey}:${identity}` : undefined;
    if (inflightKey) {
      const existing = this.inFlight.get(inflightKey);
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

    if (inflightKey) {
      this.inFlight.set(inflightKey, call);
      void call.finally(() => {
        // Only clear if still the same promise (a later call may have replaced it).
        if (this.inFlight.get(inflightKey) === call) this.inFlight.delete(inflightKey);
      });
    }

    return call;
  }
}
