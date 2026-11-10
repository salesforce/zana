import type { ServerResponse } from 'node:http';
import { getOnboardingProfile } from '../services/onboarding-profile.js';
import type { OnboardingGitAuthService } from '../services/onboarding-git-auth.js';
import { sendJson } from './json.js';

const GIT = '/api/v1/onboarding/git';

/**
 * Invoked only after the normal product API origin checks. Git sign-in routes take no body: the
 * host always comes from the bundled/host-owned profile, never from the renderer.
 */
export async function handleOnboardingApi(response: ServerResponse, path: string, method: string, gitAuth?: OnboardingGitAuthService): Promise<boolean> {
  if (path === '/api/v1/onboarding/profile') {
    if (method !== 'GET') return false;
    try {
      sendJson(response, 200, { profile: getOnboardingProfile() });
    } catch {
      sendJson(response, 503, { error: 'Setup configuration is unavailable' });
    }
    return true;
  }
  const route = path.startsWith(`${GIT}/`) ? path.slice(GIT.length + 1) : undefined;
  const allowed: Record<string, string> = { status: 'GET', 'sign-in': 'GET', 'sign-in/start': 'POST', 'sign-in/cancel': 'POST' };
  if (!route || allowed[route] !== method) return false;
  let auth;
  try { auth = getOnboardingProfile()?.gitAuth; } catch { sendJson(response, 503, { error: 'Setup configuration is unavailable' }); return true; }
  if (!auth || !gitAuth) { sendJson(response, 404, { error: 'Git sign-in is not configured' }); return true; }
  try {
    if (route === 'status') sendJson(response, 200, { status: await gitAuth.status(auth) });
    else if (route === 'sign-in') sendJson(response, 200, { state: gitAuth.getState() });
    else if (route === 'sign-in/start') sendJson(response, 200, { state: gitAuth.start(auth) });
    else sendJson(response, 200, { state: gitAuth.cancel() });
  } catch {
    sendJson(response, 500, { error: 'Git sign-in check failed' });
  }
  return true;
}
