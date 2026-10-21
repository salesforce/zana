import { PREVIEW_TARGET, PREVIEW_PATH, parsePreviewLabel, machinePreviewKey, previewPathAllowed } from '../relay/mobile/preview-policy.mjs';
import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { createRelay } from '../relay/mobile/server.mjs';
import { createConnectApi, json, readCookie, readJson } from './http.mjs';
import { ConnectError } from './registry.mjs';
import { dispatchPluginRequest } from './plugin-dispatch.mjs';
import { createBrowserAccess, BROWSER_COOKIE, STATE_COOKIE, browserCookie } from './browser-access.mjs';
import { addressError } from './addresses.mjs';
import { isMachinePath, MACHINE_CREDENTIAL_HEADER, MACHINE_HOST_HEADER, MACHINE_INSTANCE_HEADER } from '../relay/mobile/machine-routes.mjs';

const principalKey = Symbol('connectPrincipal');
const rejectSocket = (socket, status) => socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\n\r\n`);

export function createConnectGateway({ registry, db, sessionSecret, allowLocal = false, maxTunnels = 128, checkIntervalMs = 5000, reconnectGraceMs = 8000 }) {
  const accountOrigin = new URL(registry.accountUrl);
  const browser = createBrowserAccess(db, registry);
  const navigation = req => req.method === 'GET' && req.headers['sec-fetch-mode'] === 'navigate' && req.headers['sec-fetch-dest'] === 'document';
  const wantsHtml = req => req.method === 'GET' && String(req.headers.accept ?? '').includes('text/html');
  const entries = new Map();
  const previewEntries = new Map();
  const visitors = new Map();
  const responses = new Map();
  let checking = null; let closed = false;
  const closeEntry = id => {
    const entry = entries.get(id);
    if (!entry) return;
    entries.delete(id); entry.relay.close();
  };
  // A tunnel redials within a second or two after a network blip or a web
  // restart. Hold a visitor for a computer seen recently instead of showing
  // the offline page in that gap; a computer that is really off fails at once.
  const connectedEntry = async (server, gone) => {
    const deadline = Date.now() + reconnectGraceMs;
    const recent = Number(server.last_seen_at) > Date.now() - 90_000;
    for (;;) {
      const entry = entries.get(server.id);
      if (entry?.relay.connected()) return entry;
      if (!recent || closed || gone() || Date.now() >= deadline) return null;
      await new Promise(resolve => setTimeout(resolve, 100).unref());
    }
  };
  const onRevoke = (kind, id) => {
    if (kind === 'server') closeEntry(id);
    for (const [key, entry] of previewEntries) if ((kind === 'server' && entry.server.id === id) || (kind === 'machine' && entry.machine?.id === id)) { entry.relay.close(); previewEntries.delete(key); }
    for (const [ws, value] of visitors) if ((kind === 'device' && value.kind === 'device' && value.deviceId === id) || (kind === 'machine' && value.kind === 'machine' && value.id === id) || (kind === 'server' && value.serverId === id)) ws.close(1008, 'Access revoked');
    for (const [res, value] of responses) if ((kind === 'device' && value.kind === 'device' && value.deviceId === id) || (kind === 'machine' && value.kind === 'machine' && value.id === id) || (kind === 'server' && value.serverId === id)) res.destroy();
  };
  const api = createConnectApi({ registry, db, sessionSecret, onRevoke });
  const hostLabel = req => {
    const host = String(req.headers.host ?? '');
    for (const domain of [registry.domain, registry.browserDomain]) {
      const suffix = `.${domain}`;
      const label = host.endsWith(suffix) ? host.slice(0, -suffix.length) : '';
      if (/^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/.test(label) || parsePreviewLabel(label)) return label;
    }
    return null;
  };
  const trusted = req => {
    const host = String(req.headers.host ?? '');
    return (allowLocal || req.headers['x-forwarded-proto'] === 'https') &&
      (!req.headers.origin || req.headers.origin === `${accountOrigin.protocol}//${host}`) &&
      (!req.headers['sec-fetch-site'] || ['same-origin', 'none'].includes(String(req.headers['sec-fetch-site'])) || navigation(req));
  };
  const toRequest = req => new Request(`${accountOrigin.protocol}//${req.headers.host}${req.url}`, {
    method: req.method, headers: req.headers,
    ...(!['GET', 'HEAD'].includes(req.method) ? { body: Readable.toWeb(req), duplex: 'half' } : {})
  });
  const reply = async (response, res) => {
    const headers = Object.fromEntries(response.headers);
    if (response.headers.has('set-cookie')) headers['set-cookie'] = response.headers.getSetCookie();
    res.writeHead(response.status, headers);
    res.end(Buffer.from(await response.arrayBuffer()));
  };
  const redirect = (location, cookies = []) => new Response(null, { status: 303, headers: [ ['location', location], ['cache-control', 'no-store'], ['referrer-policy', 'no-referrer'], ...cookies.map(cookie => ['set-cookie', cookie]) ] });
  // Alias authorization happens first. Only this trusted routing layer may map
  // an owned public alias onto the computer's stable tunnel origin.
  const routeToTunnel = (req, server) => {
    const url = new URL(registry.serverUrl(server.label));
    req.headers.host = url.host;
    if (req.headers.origin) req.headers.origin = url.origin;
    if (req.headers['sec-fetch-site']) req.headers['sec-fetch-site'] = 'same-origin';
  };
  const getServer = async req => {
    const label = hostLabel(req);
    if (!label) throw new ConnectError('unknown_server', 404);
    const server = await registry.resolveServer(parsePreviewLabel(label)?.base ?? label);
    if (!server) throw new ConnectError('unknown_server', 404);
    // A label is served on exactly one canonical host. In particular, a public
    // alias cannot reuse its cookie/callback on the transport namespace.
    if (req.headers.host !== new URL(registry.browserUrl(label)).host) throw new ConnectError('unknown_server', 404);
    return server;
  };
  const previewFor = (req, server) => {
    const target = parsePreviewLabel(hostLabel(req));
    if (!target) return null;
    if (!entries.get(server.id)?.relay.connected()) throw new ConnectError('computer_offline', 503);
    const entry = previewEntries.get(`${server.id}:${target.machine ?? ''}`);
    if (!entry?.relay.connected()) throw new ConnectError('preview_offline', 503);
    if (!entry.relay.hasPreview(target.port)) throw new ConnectError('preview_not_shared', 404);
    req[PREVIEW_TARGET] = target.port;
    return entry;
  };
  const getDevice = async (req, server) => {
    const device = await registry.authenticateDevice(String(req.headers.authorization ?? '').replace(/^Bearer /, ''));
    if (!device || device.user_id !== server.user_id) throw new ConnectError('unauthorized', 401);
    return device;
  };
  const cookieDevice = async (req, server) => {
    const label = hostLabel(req);
    const browserToken = readCookie(req.headers.cookie, BROWSER_COOKIE);
    if (await browser.authorizeSession(server, label, browserToken)) return { kind: 'browser', label, cookie: browserToken };
    const cookie = readCookie(req.headers.cookie, 'zcc_mobile_session');
    const device = await registry.authorizeSession(server, cookie);
    if (!device) throw new ConnectError('pair_this_device', 401);
    return { kind: 'device', id: device.id, cookie };
  };
  const authorizeVisitor = value => value.kind === 'machine' ? registry.authorizeMachineGrant(value.server, value.machine) : value.kind === 'browser' ? browser.authorizeSession(value.server, value.label, value.cookie) : registry.authorizeSession(value.server, value.cookie);
  const visitor = async (req, server, upgrade = false) => {
    // Never accept caller-supplied trusted identity, including on browser requests.
    delete req.headers[MACHINE_HOST_HEADER];
    delete req.headers[MACHINE_INSTANCE_HEADER];
    const credential = req.headers[MACHINE_CREDENTIAL_HEADER];
    delete req.headers[MACHINE_CREDENTIAL_HEADER];
    if (credential !== undefined) {
      if (parsePreviewLabel(hostLabel(req)) || req.headers.origin || !isMachinePath(req.method, req.url, upgrade)) throw new ConnectError('machine_route_denied', 403);
      const machine = await registry.authenticateMachine(server, credential);
      if (!machine) throw new ConnectError('unauthorized_machine', 403);
      req.headers[MACHINE_HOST_HEADER] = machine.host_id;
      req.headers[MACHINE_INSTANCE_HEADER] = machine.instance_id;
      req.headers['x-zcc-host-id'] = machine.host_id;
      delete req.headers.cookie;
      return { kind: 'machine', id: machine.id, machine };
    }
    if ((req.url ?? '').split('?')[0].startsWith('/internal')) throw new ConnectError('not_found', 404);
    return cookieDevice(req, server);
  };
  const apiPath = req => /^\/api\/connect(?:\/|$)/.test(req.url ?? '') && req.headers.host === accountOrigin.host;
  const rates = new Map();
  function rate(serverId) {
    const now = Date.now();
    if (rates.size >= 2000) for (const [id, item] of rates) if (item.until <= now) rates.delete(id);
    let item = rates.get(serverId);
    if (!item || item.until <= now) {
      if (rates.size >= 2000 && !item) throw new ConnectError('busy', 429);
      item = { count: 0, until: now + 60_000 }; rates.set(serverId, item);
    }
    if (++item.count > 30) throw new ConnectError('too_many_attempts', 429);
  }
  const timer = setInterval(() => {
    if (checking || closed) return;
    checking = (async () => {
      for (const [id, entry] of entries) {
        const active = await registry.resolveServer(entry.server.label);
        if (!active || active.id !== id || active.credential_hash !== entry.server.credential_hash) { onRevoke('server', id); continue; }
        if (entry.relay.connected()) await registry.markSeen(id);
        else if (Date.now() - entry.createdAt > 15_000) closeEntry(id);
      }
      for (const [key, entry] of previewEntries) {
        const active = await registry.resolveServer(entry.server.label);
        const invalid = !active || active.credential_hash !== entry.server.credential_hash || !entries.get(entry.server.id)?.relay.connected() || (!entry.relay.connected() && Date.now() - entry.createdAt > 15_000) || (entry.machine && !await registry.authorizeMachineGrant(entry.server, entry.machine));
        // A publisher may reconnect while the authorization query is in flight.
        if (invalid && previewEntries.get(key) === entry) { entry.relay.close(); previewEntries.delete(key); }
      }
      // A DB-backed check also covers revocations from another web process.
      for (const [ws, value] of visitors) if (!await authorizeVisitor(value)) ws.close(1008, 'Session expired or revoked');
      for (const [res, value] of responses) if (!await authorizeVisitor(value)) res.destroy();
      await registry.prune();
    })().catch(() => {
      // Loss of the authorization store must never leave existing sessions privileged.
      for (const ws of visitors.keys()) ws.close(1011, 'Authorization service unavailable');
      for (const res of responses.keys()) res.destroy();
    }).finally(() => { checking = null; });
  }, checkIntervalMs);
  timer.unref();
  return {
    async dispatchPlugin({ accountId, serverId, pluginId, payload, timeoutMs }) {
      // Called only by authenticated in-process integrations. Resolve ownership
      // from the authoritative store on every request, including after reconnect.
      const rows = await db.query('SELECT * FROM connect_servers WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL', [serverId, accountId]);
      const server = rows[0]; const entry = entries.get(serverId);
      if (!server || !entry || entry.server.credential_hash !== server.credential_hash || !entry.relay.connected() || closed) throw new ConnectError('computer_offline', 503);
      return dispatchPluginRequest(entry.relay, registry.serverUrl(server.label), pluginId, payload, timeoutMs);
    },
    matches: req => apiPath(req) || String(req.headers.host ?? '').endsWith(`.${registry.domain}`) ||
      (req.headers.host !== accountOrigin.host && (addressError(hostLabel(req)) === null || !!parsePreviewLabel(hostLabel(req)))),
    async handleHttp(req, res) {
      try {
        if (closed) throw new ConnectError('connect_unavailable', 503);
        if (!trusted(req)) throw new ConnectError('untrusted_origin', 403);
        if (apiPath(req)) {
          const key = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '').split(',').at(-1).trim().slice(0, 100);
          return await reply(await api.dispatch(toRequest(req), key), res);
        }
        const server = await getServer(req);
        const preview = parsePreviewLabel(hostLabel(req)) ? previewFor(req, server) : null;
        const path = (req.url ?? '/').split('?')[0];
        if (path === '/_connect/login' && req.method === 'GET') {
          rate(server.id);
          const input = new URL(req.url, registry.serverUrl(server.label));
          const result = await browser.start(server, hostLabel(req), input.searchParams.get('returnTo'), input.searchParams.get('intent'));
          return await reply(redirect(result.location, [browserCookie(STATE_COOKIE, result.state, accountOrigin.protocol === 'https:', 600)]), res);
        }
        if (path === '/_connect/callback' && req.method === 'GET') {
          rate(server.id);
          const input = new URL(req.url, registry.serverUrl(server.label));
          const result = await browser.redeem(server, hostLabel(req), input.searchParams.get('code'), readCookie(req.headers.cookie, STATE_COOKIE));
          return await reply(redirect(result.returnPath, [browserCookie(BROWSER_COOKIE, result.value, accountOrigin.protocol === 'https:', result.maxAge), browserCookie(STATE_COOKIE, '', accountOrigin.protocol === 'https:', 0)]), res);
        }
        if (path.startsWith('/_connect')) throw new ConnectError('not_found', 404);
        if (preview && !previewPathAllowed(req.url)) throw new ConnectError('not_found', 404);
        if (path === '/_mobile/health' && req.method === 'GET') return await reply(json({ product: 'zcc', mobileGateway: 1, connect: true }), res);
        if (path === '/_mobile/pair' && req.method === 'POST') {
          rate(server.id); const input = await readJson(toRequest(req));
          return await reply(json(await registry.redeemPhoneCode(server, input.code, input.label)), res);
        }
        if (path === '/_mobile/session' && req.method === 'POST') {
          rate(server.id); const device = await getDevice(req, server);
          const result = await registry.createSession(server, device);
          const cookie = result.cookie;
          return await reply(json(result, 200, { 'set-cookie': `${cookie.name}=${cookie.value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=3600${cookie.secure ? '; Secure' : ''}` }), res);
        }
        if (path === '/_mobile/servers' && req.method === 'GET') {
          const device = await getDevice(req, server);
          return await reply(json({ servers: await registry.listServers(device.user_id) }), res);
        }
        if (path.startsWith('/_mobile/') || path.startsWith('/_relay/')) throw new ConnectError('not_found', 404);
        let device;
        try { device = await visitor(req, server); }
        catch (error) {
          if (error instanceof ConnectError && error.status === 401 && wantsHtml(req)) return await reply(redirect(`/_connect/login?returnTo=${encodeURIComponent(req.url ?? '/')}`), res);
          throw error;
        }
        if (closed) throw new ConnectError('connect_unavailable', 503);
        if (res.destroyed) return;
        const entry = preview ?? await connectedEntry(server, () => res.destroyed);
        if (closed) throw new ConnectError('connect_unavailable', 503);
        if (res.destroyed) return;
        if (!entry?.relay.connected()) throw new ConnectError('computer_offline', 503);
        if (device.kind === 'machine' && !entry.machines) throw new ConnectError('server_update_required', 409);
        responses.set(res, { ...device, server, serverId: server.id, deviceId: device.id });
        const release = () => responses.delete(res);
        res.once('close', release); res.once('finish', release);
        routeToTunnel(req, server);
        entry.relay.handleHttp(req, res);
      } catch (error) {
        if (!res.headersSent && wantsHtml(req) && error instanceof ConnectError && error.message === 'computer_offline') {
          return await reply(new Response('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Computer offline · Zana Connect</title><body><main><h1>Your computer is offline</h1><p>Open Zana on your computer and turn on Remote access in Settings → Remote access. Keep the computer awake and Zana running, then try again.</p><p><a href="">Try again</a></p></main></body></html>', { status: 503, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'", 'referrer-policy': 'no-referrer' } }), res);
        }
        if (!res.headersSent) await reply(json({ error: error instanceof ConnectError ? error.message : 'connect_unavailable' }, error instanceof ConnectError ? error.status : 503), res);
        else res.destroy();
      }
    },
    async handleUpgrade(req, socket, head) {
      try {
        if (!trusted(req) || closed) throw new ConnectError('untrusted_origin', 403);
        const server = await getServer(req);
        if (req.url === PREVIEW_PATH && !parsePreviewLabel(hostLabel(req))) {
          if (req.headers['x-zcc-preview-version'] !== '1') throw new ConnectError('update_required', 409);
          let machine = null;
          if (req.headers[MACHINE_CREDENTIAL_HEADER]) machine = await registry.authenticateMachine(server, req.headers[MACHINE_CREDENTIAL_HEADER]);
          else { const principal = await registry.authenticateServer(String(req.headers.authorization ?? '').replace(/^Bearer /, '')); if (!principal || principal.id !== server.id) throw new ConnectError('unauthorized', 401); }
          if (req.headers[MACHINE_CREDENTIAL_HEADER] && !machine) throw new ConnectError('unauthorized_machine', 403);
          if (closed || socket.destroyed) return;
          const key = `${server.id}:${machine ? machinePreviewKey(machine.host_id) : ''}`;
          if (!previewEntries.has(key) && previewEntries.size >= maxTunnels) throw new ConnectError('busy', 503);
          previewEntries.get(key)?.relay.close();
          const token = randomBytes(32).toString('base64url');
          const relay = createRelay({ token, publicUrl: registry.serverUrl(server.label), allowLocal, preview: true, onVisitor(ws, request) {
            const device = request[principalKey];
            if (!device) { ws.close(1008); return; }
            visitors.set(ws, { ...device, server, serverId: server.id, deviceId: device.id });
            ws.once('close', () => visitors.delete(ws));
          } });
          previewEntries.set(key, { relay, server, machine, createdAt: Date.now() });
          req.url = '/_relay/connect'; req.headers.authorization = `Bearer ${token}`;
          routeToTunnel(req, server); relay.handleUpgrade(req, socket, head); return;
        }
        if (req.url === '/_relay/connect' && !parsePreviewLabel(hostLabel(req))) {
          const principal = await registry.authenticateServer(String(req.headers.authorization ?? '').replace(/^Bearer /, ''));
          if (!principal || principal.id !== server.id) throw new ConnectError('unauthorized', 401);
          const machines = req.headers['x-zcc-relay-machine-version'] === '1';
          if (machines) await registry.bindInstance(principal, req.headers['x-zcc-product-instance']);
          await registry.markSeen(server.id);
          if (!entries.has(server.id) && entries.size >= maxTunnels) throw new ConnectError('busy', 503);
          if (closed || socket.destroyed) return;
          closeEntry(server.id);
          const internalToken = randomBytes(32).toString('base64url');
          const relay = createRelay({ token: internalToken, publicUrl: registry.serverUrl(server.label), allowLocal, edge: true,
            onVisitor(ws, request) {
              const device = request[principalKey];
              if (!device) { ws.close(1008); return; }
              visitors.set(ws, { ...device, server, serverId: server.id, deviceId: device.id });
              ws.once('close', () => visitors.delete(ws));
            }
          });
          entries.set(server.id, { relay, server, machines, createdAt: Date.now() });
          req.headers.authorization = `Bearer ${internalToken}`;
          routeToTunnel(req, server);
          relay.handleUpgrade(req, socket, head);
          return;
        }
        const preview = parsePreviewLabel(hostLabel(req)) ? previewFor(req, server) : null;
        if (preview && !previewPathAllowed(req.url)) throw new ConnectError('not_found', 404);
        if (!preview && !['/ws', '/ws/'].includes(req.url) && !isMachinePath('GET', req.url, true)) throw new ConnectError('not_found', 404);
        req[principalKey] = await visitor(req, server, true);
        if (closed) throw new ConnectError('connect_unavailable', 503);
        const entry = preview ?? await connectedEntry(server, () => socket.destroyed);
        if (closed) throw new ConnectError('connect_unavailable', 503);
        if (!entry?.relay.connected()) throw new ConnectError('computer_offline', 503);
        if (req[principalKey].kind === 'machine' && !entry.machines) throw new ConnectError('server_update_required', 409);
        if (!socket.destroyed) { routeToTunnel(req, server); entry.relay.handleUpgrade(req, socket, head); }
      } catch (error) { if (!socket.destroyed) rejectSocket(socket, error instanceof ConnectError ? error.status : 503); }
    },
    async close() { closed = true; clearInterval(timer); await checking; for (const id of entries.keys()) closeEntry(id); for (const entry of previewEntries.values()) entry.relay.close(); previewEntries.clear(); for (const ws of visitors.keys()) ws.terminate(); visitors.clear(); for (const res of responses.keys()) res.destroy(); responses.clear(); },
    connectionCount: () => entries.size
  };
}
