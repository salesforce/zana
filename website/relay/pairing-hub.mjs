import { isAllowedHttp, isAllowedWs, normalizePairingPath } from './allowlist.mjs';
import { createPairingSession } from './pairing-session.mjs';
import {
  isJoinHttp,
  isRelaySessionId,
  mintRelaySessionId,
  parseRelaySessionPath,
  resolveJoinTtlMs,
  resolveMaxSessions
} from './session-path.mjs';

/**
 * @param {{
 *   now?: () => number,
 *   joinTtlMs?: number,
 *   maxSessions?: number,
 *   env?: NodeJS.ProcessEnv
 * }} [options]
 */
export function createPairingHub(options = {}) {
  const clock = options.now ?? Date.now;
  const ttl = resolveJoinTtlMs({ env: options.env, override: options.joinTtlMs });
  const maxSessions = resolveMaxSessions({ env: options.env, override: options.maxSessions });
  /** @type {Map<string, { id: string, joinUntil: number, session: ReturnType<typeof createPairingSession> }>} */
  const sessions = new Map();

  function liveEntries() {
    return [...sessions.values()].filter((entry) => entry.session.hasLaptop());
  }

  function soleLive() {
    const live = liveEntries();
    return live.length === 1 ? live[0] : null;
  }

  function removeIfGone(id, session) {
    const entry = sessions.get(id);
    if (entry && entry.session === session && !session.hasLaptop()) {
      sessions.delete(id);
    }
  }

  function startSession(connection, id) {
    const now = clock();
    /** @type {{ id: string, joinUntil: number, session: ReturnType<typeof createPairingSession> }} */
    const entry = { id, joinUntil: now + ttl, session: null };
    const session = createPairingSession(
      () => {
        removeIfGone(id, session);
      },
      {
        onJoinRenew() {
          const current = sessions.get(id);
          if (!current) return;
          current.joinUntil = clock() + ttl;
          current.session.sendHello({ sessionId: id, joinUntil: current.joinUntil });
        }
      }
    );
    entry.session = session;
    session.attach(connection);
    sessions.set(id, entry);
    session.sendHello({ sessionId: id, joinUntil: entry.joinUntil });
    return entry;
  }

  function canAttach(reclaimId) {
    if (reclaimId) {
      if (!isRelaySessionId(reclaimId)) {
        return { ok: false, status: 400, reason: 'Bad Request' };
      }
      const existing = sessions.get(reclaimId);
      if (existing?.session.hasLaptop()) {
        return { ok: false, status: 409, reason: 'Conflict' };
      }
      if (!existing && sessions.size >= maxSessions) {
        return { ok: false, status: 503, reason: 'Service Unavailable' };
      }
      return { ok: true };
    }
    if (sessions.size >= maxSessions) {
      return { ok: false, status: 503, reason: 'Service Unavailable' };
    }
    return { ok: true };
  }

  function attach(connection, reclaimId) {
    if (reclaimId && isRelaySessionId(reclaimId)) {
      const existing = sessions.get(reclaimId);
      if (existing?.session.hasLaptop()) {
        connection.close(4009, 'conflict');
        return null;
      }
      existing?.session.dispose();
      sessions.delete(reclaimId);
      return startSession(connection, reclaimId);
    }
    return startSession(connection, mintRelaySessionId());
  }

  function rewriteUrl(request, rest) {
    const original = request.url ?? '/';
    const queryIndex = original.indexOf('?');
    const search = queryIndex >= 0 ? original.slice(queryIndex) : '';
    request.url = `${rest}${search}`;
  }

  function resolveHttpTarget(request) {
    const parsedUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
    const pathname = normalizePairingPath(parsedUrl.pathname);
    const method = request.method ?? 'GET';
    const prefixed = parseRelaySessionPath(pathname);
    if (prefixed) {
      const entry = sessions.get(prefixed.sessionId);
      if (!entry?.session.hasLaptop()) {
        return { handled: true, status: 503, error: 'relay_offline' };
      }
      if (isJoinHttp(method, prefixed.rest) && clock() >= entry.joinUntil) {
        return { handled: true, status: 410, error: 'join_expired' };
      }
      rewriteUrl(request, prefixed.rest);
      return { handled: true, entry };
    }
    if (!isAllowedHttp(method, pathname)) return { handled: false };
    const live = liveEntries();
    if (live.length === 0) return { handled: true, status: 503, error: 'relay_offline' };
    if (live.length > 1) return { handled: true, status: 503, error: 'relay_ambiguous' };
    const entry = live[0];
    if (isJoinHttp(method, pathname) && clock() >= entry.joinUntil) {
      return { handled: true, status: 410, error: 'join_expired' };
    }
    return { handled: true, entry };
  }

  function resolveWsTarget(request) {
    const parsedUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
    const pathname = normalizePairingPath(parsedUrl.pathname);
    const prefixed = parseRelaySessionPath(pathname);
    if (prefixed) {
      if (!isAllowedWs(prefixed.rest)) return { handled: false };
      const entry = sessions.get(prefixed.sessionId);
      if (!entry?.session.hasLaptop()) {
        return { handled: true, status: 503, reason: 'Service Unavailable' };
      }
      rewriteUrl(request, prefixed.rest);
      return { handled: true, entry };
    }
    if (!isAllowedWs(pathname)) return { handled: false };
    const live = liveEntries();
    if (live.length === 0) return { handled: true, status: 503, reason: 'Service Unavailable' };
    if (live.length > 1) return { handled: true, status: 503, reason: 'Service Unavailable' };
    return { handled: true, entry: live[0] };
  }

  return {
    canAttach,
    attach,
    handleHttp(request, response) {
      const target = resolveHttpTarget(request);
      if (!target.handled) return false;
      if (target.error) {
        response.writeHead(target.status, { 'content-type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ error: target.error }));
        return true;
      }
      void target.entry.session.handleHttp(request, response);
      return true;
    },
    handleUpgrade(request, socket, head) {
      const target = resolveWsTarget(request);
      if (!target.handled) return false;
      if (!target.entry) {
        return { handled: true, status: target.status ?? 503, reason: target.reason ?? 'Service Unavailable' };
      }
      target.entry.session.handleUpgrade(request, socket, head);
      return { handled: true };
    },
    hasLaptop() {
      return liveEntries().length > 0;
    },
    sessionCount() {
      return liveEntries().length;
    },
    soleLive,
    dispose() {
      for (const entry of sessions.values()) {
        entry.session.dispose();
      }
      sessions.clear();
    }
  };
}
