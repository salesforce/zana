import type { ServerResponse } from 'node:http';
import { getOnboardingProfile } from '../services/onboarding-profile.js';
import { sendJson } from './json.js';

/** Invoked only after the normal product API origin checks. */
export function handleOnboardingApi(response: ServerResponse, path: string, method: string): boolean {
  if (path !== '/api/v1/onboarding/profile' || method !== 'GET') return false;
  try {
    sendJson(response, 200, { profile: getOnboardingProfile() });
  } catch {
    sendJson(response, 503, { error: 'Setup configuration is unavailable' });
  }
  return true;
}
