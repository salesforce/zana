import { beforeEach, expect, it, vi } from 'vitest';

const deps = vi.hoisted(() => ({ run: vi.fn(), profile: vi.fn(), gh: vi.fn() }));
vi.mock('./plugin-source-command.js', () => ({ runPluginSourceCommand: deps.run }));
vi.mock('../services/onboarding-profile.js', () => ({ getOnboardingProfile: deps.profile }));
vi.mock('../services/onboarding-git-auth.js', () => ({ resolveGhBinary: deps.gh }));
import { pluginGitFailure, runPluginGitCommand } from './plugin-git-command.js';

const url = 'https://git.example.test/team/catalog.git';
const args = ['clone', '--', url, '/tmp/catalog'];
const authFailure = { code: 128, stdout: '', stderr: 'fatal: could not read Username: terminal prompts disabled' };
const success = { code: 0, stdout: 'ok', stderr: '' };
beforeEach(() => {
  vi.resetAllMocks();
  deps.run.mockResolvedValue(authFailure);
  deps.profile.mockReturnValue({ gitAuth: { host: 'git.example.test' } });
  deps.gh.mockReturnValue('/opt/GitHub CLI/gh');
});

it('preserves working credentials without looking up gh or changing Git config', async () => {
  deps.run.mockResolvedValue(success);
  await expect(runPluginGitCommand(args, '/tmp', url)).resolves.toEqual(success);
  expect(deps.run).toHaveBeenCalledExactlyOnceWith('git', args, '/tmp', { env: { LC_ALL: 'C' } });
  expect(deps.profile).not.toHaveBeenCalled();
  expect(deps.gh).not.toHaveBeenCalled();
});

it('retries once with a command-local host helper, retaining timeout, capture and cancellation', async () => {
  deps.run.mockResolvedValueOnce(authFailure).mockResolvedValueOnce(success);
  const options = { signal: new AbortController().signal, timeoutMs: 321, maxBytes: 65_536 };
  await expect(runPluginGitCommand(args, '/tmp', url, options)).resolves.toEqual(success);
  expect(deps.run).toHaveBeenCalledTimes(2);
  expect(deps.run).toHaveBeenLastCalledWith('git', [
    '-c', 'credential.https://git.example.test.helper=',
    '-c', "credential.https://git.example.test.helper=!'/opt/GitHub CLI/gh' auth git-credential",
    '-c', 'http.followRedirects=false', ...args
  ], '/tmp', { ...options, env: { LC_ALL: 'C' } });
});

it('quotes apostrophes in the helper executable and matches a configured port', async () => {
  deps.profile.mockReturnValue({ gitAuth: { host: 'localhost:9443' } });
  deps.gh.mockReturnValue("/tmp/user's CLI/gh");
  await runPluginGitCommand(args, '/tmp', 'https://localhost:9443/catalog');
  expect(deps.run.mock.calls[1][1]).toContain("credential.https://localhost:9443.helper=!'/tmp/user'\\''s CLI/gh' auth git-credential");
});

it('returns a failed retry without looping or falling back to a different account', async () => {
  await expect(runPluginGitCommand(args, '/tmp', url)).resolves.toEqual(authFailure);
  expect(deps.run).toHaveBeenCalledTimes(2);
});

it.each([
  'fatal: Authentication failed', 'remote: Repository not found.',
  'fatal: requested URL returned error: 403', 'fatal: could not read Password'
])('retries recoverable HTTPS authentication diagnostics: %s', async stderr => {
  deps.run.mockResolvedValueOnce({ ...authFailure, stderr }).mockResolvedValueOnce(success);
  await expect(runPluginGitCommand(args, '/tmp', url)).resolves.toEqual(success);
  expect(deps.run).toHaveBeenCalledTimes(2);
});

it.each([
  '/local/repo', 'ssh://git@git.example.test/team/catalog',
  'http://git.example.test/team/catalog', 'https://other.test/team/catalog',
  'https://git.example.test.attacker.test/team/catalog', 'https://git.example.test:9443/catalog',
  'https://user@git.example.test/catalog', 'https://user:secret@git.example.test/catalog'
])('does not grant gh credentials to an unmatched URL: %s', async remote => {
  await runPluginGitCommand(args, '/tmp', remote);
  expect(deps.run).toHaveBeenCalledTimes(1);
  expect(deps.gh).not.toHaveBeenCalled();
});

it.each([
  'fatal: Could not resolve host: git.example.test', 'fatal: SSL certificate problem',
  'fatal: Remote branch missing not found', 'fatal: permission denied (publickey)'
])('does not retry non-HTTPS-auth failures: %s', async stderr => {
  deps.run.mockResolvedValue({ ...authFailure, stderr });
  await runPluginGitCommand(args, '/tmp', url);
  expect(deps.run).toHaveBeenCalledTimes(1);
  expect(deps.gh).not.toHaveBeenCalled();
});

it('does not invoke gh during background discovery', async () => {
  await runPluginGitCommand(args, '/tmp', url, { nonInteractive: true });
  expect(deps.run).toHaveBeenCalledTimes(1);
  expect(deps.gh).not.toHaveBeenCalled();
});

it.each([null, {}, { gitAuth: undefined }])('leaves Git unchanged without a configured host: %j', async profile => {
  deps.profile.mockReturnValue(profile);
  await runPluginGitCommand(args, '/tmp', url);
  expect(deps.run).toHaveBeenCalledTimes(1);
});

it('leaves Git unchanged if the optional setup profile is invalid or gh is missing', async () => {
  deps.profile.mockImplementationOnce(() => { throw new Error('bad profile'); });
  await runPluginGitCommand(args, '/tmp', url);
  expect(deps.run).toHaveBeenCalledTimes(1);
  deps.gh.mockReturnValue(null);
  await runPluginGitCommand(args, '/tmp', url);
  expect(deps.run).toHaveBeenCalledTimes(2);
});

it('propagates command failures and cancellation without another attempt', async () => {
  deps.run.mockRejectedValue(new Error('Plugin source command cancelled'));
  await expect(runPluginGitCommand(args, '/tmp', url)).rejects.toThrow('cancelled');
  expect(deps.run).toHaveBeenCalledTimes(1);
});

it.each([
  ['fatal: Authentication failed https://user:PRIVATE@example.test', 'Git authentication failed'],
  ['fatal: Could not resolve host: PRIVATE', 'Could not connect'],
  ['fatal: SSL certificate problem: PRIVATE', 'Git certificate verification failed'],
  ['PRIVATE unknown diagnostic', 'git clone failed']
])('returns useful diagnostics without remote output: %s', (stderr, expected) => {
  const message = pluginGitFailure(stderr, 'git clone failed');
  expect(message).toContain(expected);
  expect(message).not.toContain('PRIVATE');
});
