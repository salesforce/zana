import { URL } from 'whatwg-url-minimum';
import type { ServerProfile } from './profiles';
import { normalizeServerUrl } from './urls';
export interface SessionCookie {
  name: string;
  value: string;
  expires: string;
  secure: boolean;
  httpOnly: boolean;
  path: string;
}
export interface MobileSession {
  cookie: SessionCookie;
  expiresAt: number;
}
export class PairingRequired extends Error {}
async function request(serverUrl: string, path: string, init: RequestInit = {}, fetcher = fetch) {
  const base = normalizeServerUrl(serverUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    let response: Response;
    try {
      response = await fetcher(base + path, {
        ...init,
        signal: controller.signal,
        redirect: 'error',
        headers: { 'x-zcc-app-surface': 'mobile', ...init.headers }
      });
    } catch {
      throw new Error(
        controller.signal.aborted
          ? 'The connection timed out. Check your network and try again.'
          : 'Could not reach your Zana server. Check that Zana is running and this phone can reach the server address.'
      );
    }
    if (response.url && new URL(response.url).origin !== base)
      throw new Error('The server redirected to another origin.');
    if (response.status === 401 || response.status === 403)
      throw new PairingRequired('This device needs to be paired again.');
    if (!response.ok)
      throw new Error(
        response.status === 429
          ? 'Too many attempts. Try again in a minute.'
          : `Server returned ${response.status}.`
      );
    if (!(response.headers.get('content-type') ?? '').includes('application/json'))
      throw new Error('This URL is not a Zana server.');
    const text = await response.text();
    if (text.length > 16_384) throw new Error('Server response is too large.');
    return JSON.parse(text) as Record<string, unknown>;
  } finally {
    clearTimeout(timer);
  }
}
export async function pairServer(serverUrl: string, code: string, label: string, fetcher = fetch) {
  const result = await request(
    serverUrl,
    '/_mobile/pair',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: code.trim(), label })
    },
    fetcher
  );
  if (
    typeof result.credential !== 'string' ||
    !/^[\w-]{43}$/.test(result.credential) ||
    typeof result.deviceId !== 'string'
  )
    throw new Error('Invalid pairing response.');
  return { credential: result.credential, deviceId: result.deviceId };
}
export async function probeDirect(serverUrl: string, fetcher = fetch) {
  const result = await request(serverUrl, '/api/v1/health', {}, fetcher);
  if (result.ok !== true) throw new Error('This URL is not a Zana server.');
}
export async function createSession(
  profile: ServerProfile,
  fetcher = fetch
): Promise<MobileSession | null> {
  if (!profile.credential) {
    await probeDirect(profile.serverUrl, fetcher);
    return null;
  }
  const result = await request(
    profile.serverUrl,
    '/_mobile/session',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${profile.credential}`,
        'content-type': 'application/json'
      },
      body: '{}'
    },
    fetcher
  );
  const cookie = result.cookie as SessionCookie | undefined;
  if (
    !cookie ||
    cookie.name !== 'zcc_mobile_session' ||
    !/^[\w-]{43}$/.test(cookie.value) ||
    cookie.path !== '/' ||
    cookie.httpOnly !== true ||
    cookie.secure !== profile.serverUrl.startsWith('https:') ||
    typeof result.expiresAt !== 'number' ||
    result.expiresAt <= Date.now() ||
    !Number.isFinite(Date.parse(cookie.expires))
  )
    throw new Error('Invalid session response.');
  return { cookie, expiresAt: result.expiresAt };
}

export async function registerPush(profile: ServerProfile, token: string | null, fetcher = fetch) {
  if (!profile.credential) throw new Error('Push notifications require a paired server.');
  await request(
    profile.serverUrl,
    '/_mobile/push',
    {
      method: token ? 'PUT' : 'DELETE',
      headers: {
        Authorization: `Bearer ${profile.credential}`,
        'content-type': 'application/json'
      },
      ...(token ? { body: JSON.stringify({ token }) } : {})
    },
    fetcher
  );
}
