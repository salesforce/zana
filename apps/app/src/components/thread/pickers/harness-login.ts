import type { HarnessFamily } from '@zana-ai/zcc-domain/product';
import type { ThreadModelCatalogSnapshot } from './thread-model-catalog.js';

export type HarnessLoginState = 'checking' | 'signed_in' | 'sign_in_required' | 'unverified';

export type HarnessLoginStatus = {
  state: HarnessLoginState;
  loginCommand: string;
};

const LOGIN_BY_FAMILY: Partial<Record<HarnessFamily, { providerId: string; loginCommand: string }>> = {
  cursor: { providerId: 'acp-cursor', loginCommand: 'cursor-agent login' },
  codex: { providerId: 'codex', loginCommand: 'codex login' },
  pi: { providerId: 'pi', loginCommand: 'pi' },
  opencode: { providerId: 'acp-opencode', loginCommand: 'opencode auth login' },
  grok: { providerId: 'acp-grok', loginCommand: 'grok login' }
};

export function loginCommandForProvider(providerId: string): string | null {
  if (providerId === 'acp-cursor' || providerId === 'cursor') return 'cursor-agent login';
  if (providerId === 'codex') return 'codex login';
  if (providerId === 'pi') return 'pi';
  if (providerId === 'acp-opencode' || providerId === 'opencode') return 'opencode auth login';
  if (providerId === 'acp-grok' || providerId === 'grok') return 'grok login';
  return null;
}

export function emptyModelsHint(providerId: string, modelLoadError: string | null | undefined): string {
  if (modelLoadError === 'auth_required') {
    const command = loginCommandForProvider(providerId);
    return command ? `Sign in with ${command}` : 'Sign in to load models';
  }
  // Pi has no static fallback catalog. An empty list after a successful
  // `model/list` means no provider credentials in ~/.pi (or env keys the
  // GUI app can see) — same signal as health `unauthenticated`.
  if (providerId === 'pi' && !modelLoadError) {
    return 'Sign in with pi';
  }
  return 'No models available';
}

export function harnessLoginStatus(
  family: HarnessFamily,
  catalog: ThreadModelCatalogSnapshot,
  installed: boolean
): HarnessLoginStatus | null {
  const login = LOGIN_BY_FAMILY[family];
  if (!login || !installed) return null;
  const entry = catalog.byProvider[login.providerId];
  if (!entry || catalog.inflight.has(login.providerId)) {
    return { state: 'checking', loginCommand: login.loginCommand };
  }
  if (entry.modelLoadError === 'auth_required') {
    return { state: 'sign_in_required', loginCommand: login.loginCommand };
  }
  if (entry.modelLoadError) {
    return { state: 'unverified', loginCommand: login.loginCommand };
  }
  if (entry.models.length === 0) {
    // Pi's empty catalog is "no credentials". OpenCode has no credential probe,
    // so an empty/timeout-free list is unverified rather than signed in.
    if (family === 'pi') {
      return { state: 'sign_in_required', loginCommand: login.loginCommand };
    }
    if (family === 'opencode' || family === 'grok') {
      return { state: 'unverified', loginCommand: login.loginCommand };
    }
  }
  return { state: 'signed_in', loginCommand: login.loginCommand };
}
