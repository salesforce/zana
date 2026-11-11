import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getOnboardingProfile } from '../services/onboarding-profile.js';
import { handleOnboardingApi } from './product-onboarding.js';
import type { OnboardingGitAuthService } from '../services/onboarding-git-auth.js';

let server: Server;
let url: string;
const git = { status: vi.fn(), getState: vi.fn(), start: vi.fn(), cancel: vi.fn() };
let gitService: OnboardingGitAuthService | undefined;
beforeEach(async () => {
  vi.stubEnv('ZCC_ONBOARDING_PROFILE', '');
  vi.resetAllMocks(); gitService = git as unknown as OnboardingGitAuthService;
  server = createServer((request, response) => {
    void handleOnboardingApi(response, request.url!, request.method!, gitService).then(handled => { if (!handled) response.writeHead(404).end(); });
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

const withGitAuth = { id: 'example', organization: 'Example', question: 'Employee?', prerequisite: 'Connect.', marketplaceSource: 'path:/fixture',
  gitAuth: { host: 'git.example.test', method: 'gh-device' } };
it('bundled Salesforce profile configures browser Git sign-in for its marketplace host', () => {
  expect(getOnboardingProfile({})?.gitAuth).toEqual({ host: 'git.soma.salesforce.com', method: 'gh-device' });
});
it('routes Git sign-in to the profile host only, never a renderer-supplied one', async () => {
  vi.stubEnv('ZCC_ONBOARDING_PROFILE', JSON.stringify(withGitAuth));
  git.status.mockResolvedValue({ host: 'git.example.test', reachable: true, cli: 'available', signedIn: 'no' });
  git.getState.mockReturnValue({ phase: 'idle' });
  git.start.mockReturnValue({ phase: 'starting' });
  git.cancel.mockReturnValue({ phase: 'idle' });
  expect(await (await fetch(`${url}/api/v1/onboarding/git/status`)).json()).toEqual({ status: expect.objectContaining({ signedIn: 'no' }) });
  expect(git.status).toHaveBeenCalledWith(withGitAuth.gitAuth);
  expect(await (await fetch(`${url}/api/v1/onboarding/git/sign-in`)).json()).toEqual({ state: { phase: 'idle' } });
  const started = await fetch(`${url}/api/v1/onboarding/git/sign-in/start`, { method: 'POST', body: JSON.stringify({ host: 'evil.test' }) });
  expect(await started.json()).toEqual({ state: { phase: 'starting' } });
  expect(git.start).toHaveBeenCalledWith(withGitAuth.gitAuth);
  expect(await (await fetch(`${url}/api/v1/onboarding/git/sign-in/cancel`, { method: 'POST' })).json()).toEqual({ state: { phase: 'idle' } });
});
it.each([
  ['GET', '/api/v1/onboarding/git/sign-in/start'], ['POST', '/api/v1/onboarding/git/status'],
  ['GET', '/api/v1/onboarding/git/unknown'], ['GET', '/api/v1/onboarding/git']
])('rejects %s %s', async (method, path) => {
  vi.stubEnv('ZCC_ONBOARDING_PROFILE', JSON.stringify(withGitAuth));
  expect((await fetch(url + path, { method })).status).toBe(404);
});
it('reports Git sign-in as unconfigured without a profile host or service, and unavailable on a bad profile', async () => {
  const { gitAuth: _omit, ...plain } = withGitAuth;
  vi.stubEnv('ZCC_ONBOARDING_PROFILE', JSON.stringify(plain));
  expect((await fetch(`${url}/api/v1/onboarding/git/status`)).status).toBe(404);
  vi.stubEnv('ZCC_ONBOARDING_PROFILE', JSON.stringify(withGitAuth));
  gitService = undefined;
  expect((await fetch(`${url}/api/v1/onboarding/git/status`)).status).toBe(404);
  vi.stubEnv('ZCC_ONBOARDING_PROFILE', '{broken');
  expect((await fetch(`${url}/api/v1/onboarding/git/status`)).status).toBe(503);
});
it('hides probe failures behind a generic error', async () => {
  vi.stubEnv('ZCC_ONBOARDING_PROFILE', JSON.stringify(withGitAuth));
  git.status.mockRejectedValue(new Error('secret detail'));
  const response = await fetch(`${url}/api/v1/onboarding/git/status`);
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: 'Git sign-in check failed' });
});
