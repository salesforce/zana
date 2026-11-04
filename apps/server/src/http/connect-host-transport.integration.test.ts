import { getHost } from '@zana-ai/zcc-db';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { openConnectDatabase } from '../../../../website/connect/database.mjs';
import { createRegistry } from '../../../../website/connect/registry.mjs';
import { createConnectGateway } from '../../../../website/connect/gateway.mjs';
import { connectRelay } from '../../../../services/mobile-relay/client.mjs';
import { startMobileGateway } from '../mobile/gateway.js';
import { MobileDeviceStore } from '../mobile/device-store.js';
import { startProductServer } from './product-server.js';
import { enrollDaemonHost } from '../../../host-daemon/src/enroll.js';
import { connectHostFetch } from '../../../host-daemon/src/connect-access.js';
import { startEnrolledHostConnection } from '../../../host-daemon/src/server-connection.js';
import type { CommandRuntime } from '../../../host-daemon/src/command-dispatch.js';
import { createPluginToolCallHttpClient } from '../../../host-daemon/src/plugin-tool-call-client.js';
import { createCliCallbackForwarder } from '../../../host-daemon/src/cli-callback-client.js';
import { startCliCallbackProxy } from '../../../host-daemon/src/cli-callback-proxy.js';
import { createProductCliCallbackAuthority } from '../services/launch/cli-callback-authority.js';

const cleanup: Array<() => unknown | Promise<unknown>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
const token = () => randomBytes(32).toString('base64url');
function runtime(dataDir: string): CommandRuntime {
  return { dataDir, environments: new Map(), threads: new Map(), terminals: new Map(), provisionSignals: new Map(), lanes: new Map(), loadConfig: () => ({}), verifyProviders: async () => ({ providers: [] }), emit: () => {} };
}

it('enrolls two hosts through the account tunnel with inner auth, callbacks, recovery and independent revocation', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zcc-connect-hosts-'));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const product = await startProductServer({ dataDir: join(dir, 'product'), origins: { serverPort: 0 } });
  cleanup.push(() => product.close());
  const db = await openConnectDatabase(':memory:', { production: false }); await db.migrate();
  cleanup.push(() => db.close());
  const registry = createRegistry(db, { domain: 'connect.example.com', accountUrl: 'https://example.com' });
  const ownerCode = await registry.createComputerCode('alice');
  const registration = await registry.redeemComputerCode(ownerCode.code, 'Shared Zana');
  const principal = await registry.authenticateServer(registration.credential);
  const gateway = createConnectGateway({ registry, db, sessionSecret: 'fixture', allowLocal: true, checkIntervalMs: 30 });
  cleanup.push(() => gateway.close());
  // A local fixture substitutes DNS/TLS only. Requests still cross every real relay/gateway handler.
  const publicServer = createServer((req, res) => {
    req.headers.host = new URL(registration.serverUrl).host;
    req.headers['x-forwarded-proto'] = 'https';
    void gateway.handleHttp(req, res);
  });
  publicServer.on('upgrade', (req, socket, head) => {
    req.headers.host = new URL(registration.serverUrl).host;
    req.headers['x-forwarded-proto'] = 'https';
    void gateway.handleUpgrade(req, socket, head);
  });
  await new Promise<void>(resolve => publicServer.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => new Promise<void>(resolve => { publicServer.closeAllConnections(); publicServer.close(() => resolve()); }));
  const serverUrl = `http://127.0.0.1:${(publicServer.address() as import('node:net').AddressInfo).port}`;
  const gatewayCredential = token();
  const local = await startMobileGateway({ upstream: product.url, publicUrl: serverUrl, host: '127.0.0.1', port: 0, devices: new MobileDeviceStore(join(dir, 'devices.json')), connectGatewayCredential: gatewayCredential, connectInstanceId: product.ctx.productInstanceId });
  cleanup.push(() => local.close());
  const relay = connectRelay({ publicUrl: serverUrl, token: registration.credential, gatewayPort: local.port, gatewayCredential, productInstanceId: product.ctx.productInstanceId, allowLocal: true });
  cleanup.push(() => relay.close());
  await expect.poll(() => relay.state()).toBe('connected');
  const hosts = [];
  for (let index = 0; index < 2; index++) {
    const issued = product.ctx.joinCodes.mint();
    const invite = await registry.createMachineCode(principal, { instanceId: product.ctx.productInstanceId, hostId: issued.hostId, enrollToken: issued.joinCode, name: `Host ${index}` });
    const grant = await registry.redeemMachineCode(invite.code, token());
    const fetchFn = connectHostFetch(serverUrl, grant.credential);
    const input = { serverUrl, token: grant.enrollToken, hostId: grant.hostId, instanceId: randomUUID(), hostName: `Host ${index}`, fetchFn };
    const enrolled = await enrollDaemonHost(input);
    expect(await enrollDaemonHost(input)).toEqual(enrolled);
    const connection = startEnrolledHostConnection({ serverUrl, hostId: enrolled.hostId, hostKey: enrolled.hostKey, connectCredential: grant.credential, runtime: runtime(join(dir, `host-${index}`)) });
    cleanup.push(() => connection.close());
    await connection.ready;
    hosts.push({ grant, enrolled, connection, fetchFn });
    const tool = createPluginToolCallHttpClient({ serverUrl, hostId: enrolled.hostId, hostKey: enrolled.hostKey, sessionId: input.instanceId, fetchFn });
    const result = await tool.invoke({ threadId: randomUUID(), providerThreadId: 'fixture', turnId: 'turn', callId: 'call', tool: 'fixture_tool', arguments: {} });
    expect(result).toMatchObject({ success: false, contentItems: [{ type: 'inputText', text: expect.stringContaining('Unknown thread') }] });
  }
  expect(product.ctx.hostHub.connectedHostIds().sort()).toEqual(hosts.map(h => h.enrolled.hostId).sort());
  expect(await registry.listServers('alice')).toHaveLength(1);
  const first = hosts[0]!, second = hosts[1]!;
  const callbacks: Array<{ path: string; body: string }> = [];
  const callbackServer = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    callbacks.push({ path: req.url!, body }); res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
  });
  await new Promise<void>(resolve => callbackServer.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => new Promise<void>(resolve => { callbackServer.closeAllConnections(); callbackServer.close(() => resolve()); }));
  product.ctx.cliCallbacks = createProductCliCallbackAuthority(product.ctx, () => `http://127.0.0.1:${(callbackServer.address() as { port: number }).port}`);
  const project = await product.ctx.projects.add(join(dir, 'host-checkout'), { hostId: first.enrolled.hostId });
  const callbackGrant = { projectId: project.id, sessionId: randomUUID(), credential: randomBytes(32).toString('hex') };
  product.ctx.terminalSessions.set(callbackGrant.sessionId, {
    id: callbackGrant.sessionId, projectId: project.id, hostId: first.enrolled.hostId,
    daemonInstanceId: product.ctx.hostHub.getSession(first.enrolled.hostId)!.instanceId,
    title: 'CLI callback fixture', profile: 'claude', status: 'running', cwd: project.path, createdAt: Date.now()
  });
  product.ctx.cliCallbacks.register(callbackGrant);
  const forward = (host: typeof first) => createCliCallbackForwarder({ grant: callbackGrant, serverUrl, hostId: host.enrolled.hostId, hostKey: host.enrolled.hostKey, fetchFn: host.fetchFn });
  const callbackProxy = await startCliCallbackProxy({ grant: callbackGrant, forward: forward(first) }); cleanup.push(() => callbackProxy.close());
  const callbackPath = `/mcp/${project.id}/${callbackGrant.sessionId}/${callbackGrant.credential}`;
  const callbackResponse = await fetch(callbackProxy.baseUrl + callbackPath, { method: 'POST', body: '{"method":"tools/list"}' });
  const callbackBody = await callbackResponse.text();
  expect(callbackResponse.status, callbackBody).toBe(200);
  expect(JSON.parse(callbackBody)).toEqual({ ok: true });
  expect(callbacks).toEqual([{ path: callbackPath, body: '{"method":"tools/list"}' }]);
  const callbackRequest = { path: callbackPath, body: Buffer.from('{}'), headers: {}, signal: new AbortController().signal };
  await expect(forward(second)(callbackRequest)).rejects.toThrow('(403)');
  expect(callbacks).toHaveLength(1);
  expect((await first.fetchFn(`${serverUrl}/api/v1/config`)).status).toBe(403);
  const wrongKey = await first.fetchFn(`${serverUrl}/internal/hosts/tool-call`, { method: 'POST', headers: { authorization: `Bearer ${second.enrolled.hostKey}`, 'x-zcc-host-id': second.enrolled.hostId, 'content-type': 'application/json' }, body: '{}' });
  expect(wrongKey.status).toBe(401);
  const phone = await registry.redeemPhoneCode(principal, (await registry.createPhoneCode(principal)).code, 'Phone');
  const session = await registry.createSession(principal, await registry.authenticateDevice(phone.credential));
  expect((await fetch(`${serverUrl}/internal/hosts/tool-call`, { method: 'POST', headers: { cookie: `zcc_mobile_session=${session.cookie.value}`, 'x-zcc-connect-machine-host': first.enrolled.hostId, 'x-zcc-connect-machine-instance': product.ctx.productInstanceId } })).status).toBe(404);
  expect((await fetch(`${serverUrl}/internal/hosts/tool-call`, { method: 'POST', headers: { 'x-zcc-machine-credential': phone.credential } })).status).toBe(403);
  expect((await fetch(`${serverUrl}/internal/hosts/cli-callback`, { method: 'POST', headers: { cookie: `zcc_mobile_session=${session.cookie.value}` }, body: '{}' })).status).toBe(404);
  await registry.revokeMachine(principal, first.enrolled.hostId);
  await expect.poll(() => product.ctx.hostHub.connectedHostIds()).toEqual([second.enrolled.hostId]);
  expect((await first.fetchFn(`${serverUrl}/internal/hosts/tool-call`, { method: 'POST' })).status).toBe(403);
  await expect(forward(first)(callbackRequest)).rejects.toThrow('(403)');
  expect(callbacks).toHaveLength(1);
  expect((await second.fetchFn(`${serverUrl}/internal/hosts/tool-call`, { method: 'POST', headers: { authorization: `Bearer ${second.enrolled.hostKey}`, 'content-type': 'application/json' }, body: '{}' })).status).toBe(400);
}, 20_000);

it('admits a forward-only founding host on the machine class: enroll and socket only, 403 on every execution path', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zcc-connect-forward-'));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const product = await startProductServer({ dataDir: join(dir, 'product'), origins: { serverPort: 0 } });
  cleanup.push(() => product.close());
  const db = await openConnectDatabase(':memory:', { production: false }); await db.migrate();
  cleanup.push(() => db.close());
  const registry = createRegistry(db, { domain: 'connect.example.com', accountUrl: 'https://example.com' });
  const registration = await registry.redeemComputerCode((await registry.createComputerCode('alice')).code, 'Shared Zana');
  const principal = await registry.authenticateServer(registration.credential);
  const gateway = createConnectGateway({ registry, db, sessionSecret: 'fixture', allowLocal: true, checkIntervalMs: 30 });
  cleanup.push(() => gateway.close());
  const publicServer = createServer((req, res) => {
    req.headers.host = new URL(registration.serverUrl).host;
    req.headers['x-forwarded-proto'] = 'https';
    void gateway.handleHttp(req, res);
  });
  publicServer.on('upgrade', (req, socket, head) => {
    req.headers.host = new URL(registration.serverUrl).host;
    req.headers['x-forwarded-proto'] = 'https';
    void gateway.handleUpgrade(req, socket, head);
  });
  await new Promise<void>(resolve => publicServer.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => new Promise<void>(resolve => { publicServer.closeAllConnections(); publicServer.close(() => resolve()); }));
  const serverUrl = `http://127.0.0.1:${(publicServer.address() as import('node:net').AddressInfo).port}`;
  const gatewayCredential = token();
  const local = await startMobileGateway({ upstream: product.url, publicUrl: serverUrl, host: '127.0.0.1', port: 0, devices: new MobileDeviceStore(join(dir, 'devices.json')), connectGatewayCredential: gatewayCredential, connectInstanceId: product.ctx.productInstanceId });
  cleanup.push(() => local.close());
  const relay = connectRelay({ publicUrl: serverUrl, token: registration.credential, gatewayPort: local.port, gatewayCredential, productInstanceId: product.ctx.productInstanceId, allowLocal: true });
  cleanup.push(() => relay.close());
  await expect.poll(() => relay.state()).toBe('connected');

  // Connect stores no capability: a forward-only join code rides the ordinary machine code path.
  const forwardOnly = product.ctx.joinCodes.mintForwardOnly();
  const invite = await registry.createMachineCode(principal, { instanceId: product.ctx.productInstanceId, hostId: forwardOnly.hostId, enrollToken: forwardOnly.joinCode, name: 'Zana peer link: Peer (sync only)' });
  const grant = await registry.redeemMachineCode(invite.code, token());
  const fetchFn = connectHostFetch(serverUrl, grant.credential);
  const input = { serverUrl, token: grant.enrollToken, hostId: grant.hostId, instanceId: randomUUID(), hostName: 'Peer', fetchFn };
  const enrolled = await enrollDaemonHost(input);
  expect(enrolled.hostId).toBe(forwardOnly.hostId);
  expect(await enrollDaemonHost(input)).toEqual(enrolled);
  expect(getHost(product.ctx.db, enrolled.hostId)?.enrollmentCapability).toBe('peer.forward');

  const connection = startEnrolledHostConnection({ serverUrl, hostId: enrolled.hostId, hostKey: enrolled.hostKey, connectCredential: grant.credential, runtime: runtime(join(dir, 'forward-host')) });
  cleanup.push(() => connection.close());
  await connection.ready;
  expect(product.ctx.hostHub.connectedHostIds()).toEqual([enrolled.hostId]);

  // The forward-only host never passes authenticateHostCall, nor the plugin host asset check.
  const headers = { authorization: `Bearer ${enrolled.hostKey}`, 'x-zcc-host-id': enrolled.hostId, 'content-type': 'application/json' };
  for (const path of ['/internal/hosts/tool-call', '/internal/hosts/cli-callback', '/internal/hosts/interactive-request', '/internal/hosts/interactive-request/interrupt']) {
    expect((await fetchFn(`${serverUrl}${path}`, { method: 'POST', headers, body: '{}' })).status, path).toBe(403);
  }
  expect((await fetchFn(`${serverUrl}/internal/plugins/p/host/${'a'.repeat(64)}`, { headers })).status).toBe(403);

  // An execution code for another host with this credential is refused (machine header is bound to this host).
  const executionHost = product.ctx.joinCodes.mint();
  expect((await fetchFn(`${serverUrl}/internal/hosts/enroll`, { method: 'POST', headers: { authorization: `Bearer ${executionHost.joinCode}`, 'content-type': 'application/json' }, body: '{}' })).status).toBeGreaterThanOrEqual(400);
  expect(getHost(product.ctx.db, executionHost.hostId)).toBeFalsy();

  // Revocation drops the live socket.
  await registry.revokeMachine(principal, enrolled.hostId);
  await expect.poll(() => product.ctx.hostHub.connectedHostIds()).toEqual([]);
}, 20_000);
