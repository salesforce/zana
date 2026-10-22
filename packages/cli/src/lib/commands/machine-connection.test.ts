import { expect, it, vi } from 'vitest';
import { runCli } from '../run-cli.js';

const run = (args: string[], fetchImpl: typeof fetch = vi.fn()) => runCli(['node', 'zcc', 'machine', ...args], { fetchImpl, serverUrl: 'http://127.0.0.1:8780' });
const stream = (...events: unknown[]) => new Response(events.map(e => JSON.stringify(e)).join('\n') + '\n', { headers: { 'content-type': 'application/x-ndjson' } });

it.each([
  ['connect'], ['install'], ['repair'], ['repair', '--bad'], ['repair', 'id', 'extra'],
  ['connect', '--project'], ['connect', '--ssh='], ['connect', '--ssh', 'host', '--project', 'p'],
  ['connect', '--project', 'p', '--user', 'me'], ['connect', '--ssh', 'host', '--user'], ['connect', '--unknown', 'x']
].map(args => [args]))('rejects invalid connection arguments %j before calling main', async args => {
  const fetchImpl = vi.fn();
  expect((await run(args, fetchImpl)).exitCode).toBe(2);
  expect(fetchImpl).not.toHaveBeenCalled();
});
it.each([
  [['connect', '--project', 'p'], '/api/v1/hosts/bootstrap', { projectId: 'p' }],
  [['install', '--ssh=box', '--user=me'], '/api/v1/hosts/bootstrap', { ssh: { host: 'box', user: 'me' } }],
  [['connect', '--ssh', 'box'], '/api/v1/hosts/bootstrap', { ssh: { host: 'box' } }],
  [['repair', 'host/a'], '/api/v1/hosts/host%2Fa/repair', {}]
] as const)('delegates %j to the existing main-authorized endpoint', async (args, path, body) => {
  const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => stream({ type: 'stage', stage: 'ssh', status: 'passed' }, { type: 'done', hostId: 'h' }));
  const result = await run([...args, '--json'], fetchImpl);
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, hostId: 'h' });
  expect(String(fetchImpl.mock.calls[0][0]).endsWith(path)).toBe(true);
  expect(fetchImpl.mock.calls[0][1]).toMatchObject({ method: 'POST', body: JSON.stringify(body), signal: expect.any(AbortSignal) });
});
it('returns failure for HTTP 200 error events, hides pairing commands and redacts logs', async () => {
  const fetchImpl = vi.fn(async () => stream({ type: 'log', text: 'token=secret-value --join-code zcde_secret' },
    { type: 'error', message: 'Enrollment refused', code: 'install_failed', pairingCommand: 'curl https://private/one-time' }));
  const result = await run(['repair', 'h', '--json'], fetchImpl);
  expect(result.exitCode).toBe(1);
  expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, error: 'Enrollment refused' });
  expect(result.stderr).toContain('Enrollment refused');
  for (const secret of ['secret-value', 'zcde_secret', 'one-time', 'pairingCommand']) expect(result.stdout).not.toContain(secret);
});
it.each(['', '{}\n', 'not json\n', '{"type":"log","text":"interrupted"}\n', '{"type":"done"}\n'])(
  'does not report empty, malformed or incomplete streams as successful: %j', async body => {
    expect((await run(['repair', 'h'], async () => new Response(body))).exitCode).toBe(1);
  }
);
it('preserves HTTP refusal and network failures', async () => {
  expect((await run(['repair', 'h'], async () => new Response('{"message":"Host not found"}', { status: 404 }))).exitCode).toBe(3);
  expect((await run(['repair', 'h'], async () => { throw new Error('offline'); })).stderr).toContain('offline');
});
it('prints readable stages and connected identity without JSON', async () => {
  const result = await run(['repair', 'h'], async () => stream({ type: 'stage', stage: 'install', status: 'passed', reason: 'Repaired' }, { type: 'log', text: 'Ready' }, { type: 'done', hostId: 'h' }));
  expect(result.stdout).toContain('install: passed — Repaired\nReady\nConnected: h');
});
