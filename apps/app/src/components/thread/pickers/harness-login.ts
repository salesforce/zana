import type { HarnessFamily } from '@zana-ai/zcc-domain/product';
import type { ThreadModelCatalogSnapshot } from './thread-model-catalog.js';

export type HarnessLoginState = 'checking' | 'signed_in' | 'sign_in_required' | 'unverified';

export type HarnessLoginStatus = {
  state: HarnessLoginState;
  loginCommand: string;
};

const LOGIN_BY_FAMILY: Partial<Record<HarnessFamily, { providerId: string; loginCommand: string }>> = {
  cursor: { providerId: 'acp-cursor', loginCommand: 'cursor-agent login' },
  codex: { providerId: 'codex', loginCommand: 'codex login' }
};

export function loginCommandForProvider(providerId: string): string | null {
  if (providerId === 'acp-cursor' || providerId === 'cursor') return 'cursor-agent login';
  if (providerId === 'codex') return 'codex login';
  return null;
}

export function emptyModelsHint(providerId: string, modelLoadError: string | null | undefined): string {
  if (modelLoadError === 'auth_required') {
    const command = loginCommandForProvider(providerId);
    return command ? `Sign in with ${command}` : 'Sign in to load models';
  }
  // Pi has no static fallback catalog. An empty list after a successful
  // `model/list` means no provider credentials in ~/.pi (or env keys the
  // GUI app can see) — not a picker bug.
  if (providerId === 'pi' && !modelLoadError) {
    return 'No models available. Verify your PI configuration.';
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
  return { state: 'signed_in', loginCommand: login.loginCommand };
}
