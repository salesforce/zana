import type { LlmProviderId, LlmRunResult } from '../../shared/types.js';

/**
 * One request to a provider. The fields are the post-template-fill primitives —
 * {@link LlmService} owns turning an {@link import('../../shared/types.js').LlmPromptEntry}
 * + caller vars into this shape, so a provider never sees the registry model.
 */
export interface LlmRunRequest {
  system: string;
  user: string;
  /** Model alias or id; provider falls back to its own default when absent. */
  model?: string;
  /** Hard clamp on returned text length. */
  maxOutputChars?: number;
  /** Call timeout in ms. */
  timeoutMs?: number;
  /** Optional cancellation. Providers that spawn/fetch should abort on this signal. */
  signal?: AbortSignal;
}

/**
 * The provider seam. Each transport (claude CLI now; Anthropic SDK / OpenAI /
 * Gemini later) implements this one method. Adding a provider is a new file
 * that implements `LlmProvider` and a registration in the provider map — no
 * change to {@link LlmService} or any caller. Implementations MUST resolve to an
 * {@link LlmRunResult} (never throw) so the service stays a thin dispatcher.
 */
export interface LlmProvider {
  readonly id: LlmProviderId;
  run(req: LlmRunRequest): Promise<LlmRunResult>;
  /**
   * Whether this provider is usable RIGHT NOW — i.e. its prerequisite (an API
   * key, a resolvable binary) is in place. Drives the Settings → Prompts picker
   * so a user only sees providers that will actually succeed, instead of picking
   * one that silently returns `ok:false 'no API key'`. Optional: a provider that
   * omits it is treated as always-configured (the claude-cli default — it reuses
   * the ambient login, so there's no key to check). Pure + cheap (a key lookup);
   * never spawns or fetches.
   */
  isConfigured?(): boolean;
}

/** A provider registry — id → implementation. Built once at boot. */
export type LlmProviderMap = Map<LlmProviderId, LlmProvider>;
