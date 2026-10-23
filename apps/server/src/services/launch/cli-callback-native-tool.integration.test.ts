import { execFile } from 'node:child_process';
import { afterEach, expect, it, vi } from 'vitest';
import { startCliCallbackProxy } from '../../../../host-daemon/src/cli-callback-proxy.js';
import { nativeToolRelayTail } from '../../../../host-daemon/src/harness/native-tool-relay.js';
import { CliCallbackAuthority } from './cli-callback-authority.js';

vi.mock('@zana-ai/zcc-db', () => ({ getHost: vi.fn(() => ({ id: 'host' })) }));
const grant = { projectId: 'project', sessionId: '11111111-1111-4111-8111-111111111111', credential: 'a'.repeat(64) };
const closers: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(closers.splice(0).map(close => close())); });

/** Wire the real proxy to the real authority and run the exact curl + relay tail the Claude hook runs. */
async function hook(decide: (request: unknown) => Promise<unknown>) {
  const owner = { projectId: grant.projectId, hostId: 'host', daemonInstanceId: 'daemon', active: true, profile: 'claude' };
  const authority = new CliCallbackAuthority({ owner: () => owner, mcpBaseUrl: () => 'http://127.0.0.1:1', plugins: () => ({ decideToolPolicy: decide as never }) });
  authority.register(grant);
  const proxy = await startCliCallbackProxy({
    grant,
    async forward(request) {
      const wire = await authority.forward('host', { sessionId: grant.sessionId, path: request.path, headers: {}, bodyBase64: request.body.toString('base64') }, request.signal);
      return { status: wire.status, contentType: wire.contentType, body: Buffer.from(wire.bodyBase64, 'base64') };
    }
  });
  closers.push(proxy.close, async () => authority.dispose());
  const url = `${proxy.baseUrl}/hook/nativetool/${grant.projectId}/${grant.sessionId}`;
  const script = `OUT=$(printf '%s' "$ZCC_BODY" | curl --fail -s -m 5 -X POST -H 'Content-Type: application/json' --data-binary @- "$ZCC_NATIVETOOL_URL"); STATUS=$?; ${nativeToolRelayTail()}`;
  const body = JSON.stringify({ tool_use_id: 'u1', tool_name: 'Bash', tool_input: { command: 'ls' } });
  const started = Date.now();
  const stdout = await new Promise<string>((resolve, reject) => execFile('sh', ['-c', script], { env: { PATH: process.env.PATH ?? '', ZCC_BODY: body, ZCC_NATIVETOOL_URL: url } }, (error, out) => error ? reject(error) : resolve(out)));
  return { stdout, elapsed: Date.now() - started };
}

it('lets an allowed tool call through the proxy with no relay output', async () => {
  expect((await hook(async () => ({ action: 'allow' }))).stdout).toBe('');
});
it('relays a real plugin deny, never "native tool policy unreachable"', async () => {
  const { stdout } = await hook(async () => ({ action: 'deny', reason: 'plugin says no' }));
  expect(stdout).toContain('plugin says no'); expect(stdout).not.toContain('unreachable');
});
it('denies a hanging policy through the proxy inside the relay budget', async () => {
  const { stdout, elapsed } = await hook(() => new Promise(() => undefined));
  expect(stdout).toContain('native tool policy timed out'); expect(elapsed).toBeLessThan(5_000);
}, 10_000);
