import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getOnboardingProfile } from '../services/onboarding-profile.js';
import { handleOnboardingApi } from './product-onboarding.js';

let server: Server;
let url: string;
beforeEach(async () => {
  vi.stubEnv('ZCC_ONBOARDING_PROFILE', '');
  server = createServer((request, response) => {
    if (!handleOnboardingApi(response, request.url!, request.method!)) response.writeHead(404).end();
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterEach(async () => { vi.unstubAllEnvs(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
it('serves bundled distribution metadata without accessing the internal network', async () => {
  expect(await (await fetch(`${url}/api/v1/onboarding/profile`)).json()).toEqual({ profile: getOnboardingProfile({}) });
  expect(getOnboardingProfile({})?.question).toBe('Are you a Salesforce employee?');
});
it('can disable or replace the profile at the host distribution boundary', async () => {
  vi.stubEnv('ZCC_ONBOARDING_PROFILE', 'off');
  expect(await (await fetch(`${url}/api/v1/onboarding/profile`)).json()).toEqual({ profile: null });
  const profile = { id: 'example', organization: 'Example', question: 'Employee?', prerequisite: 'Connect.', marketplaceSource: 'path:/fixture' };
  vi.stubEnv('ZCC_ONBOARDING_PROFILE', JSON.stringify(profile));
  expect(await (await fetch(`${url}/api/v1/onboarding/profile`)).json()).toEqual({ profile });
});
it.each(['{broken', JSON.stringify({ id: 'missing-fields' }), 'x'.repeat(16_385)])('fails closed on malformed metadata without exposing its contents', async value => {
  vi.stubEnv('ZCC_ONBOARDING_PROFILE', value);
  const response = await fetch(`${url}/api/v1/onboarding/profile`);
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: 'Setup configuration is unavailable' });
});
it.each(['/api/v1/onboarding', '/api/v1/onboarding/profile/extra'])('leaves unrelated routes alone: %s', async path => {
  expect((await fetch(url + path)).status).toBe(404);
});
it('does not expose a mutation API or accept a renderer-supplied profile', async () => {
  expect((await fetch(`${url}/api/v1/onboarding/profile`, { method: 'POST', body: '{}' })).status).toBe(404);
});
