import { hostname } from 'node:os';
import { CONNECT_ACCESS_REVOKED_MESSAGE } from '@zana-ai/zcc-domain/product';
import { validateMobileConnection, type MobileConnectionInput } from './connection.js';

export interface EnrollmentView { verificationUrl: string; expiresAt: number }
export type ConnectFetch = typeof fetch;

export class ConnectRequestError extends Error {
  /** `code`: Connect's machine-readable error (e.g. `cross_account`), when the service returned one. */
  constructor(readonly status: number, readonly code?: string) {
    super(status === 401 || status === 403 ? CONNECT_ACCESS_REVOKED_MESSAGE : `Connect returned ${status}. Check the service and try again.`);
  }
}

/** Reads Connect's bounded `{ error }` code; anything else is discarded. */
async function errorCode(response: Response): Promise<string | undefined> {
  if (!response.headers.get('content-type')?.includes('application/json')) { await response.body?.cancel(); return undefined; }
  const reader = response.body?.getReader(); if (!reader) return undefined;
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 4096) { await reader.cancel(); return undefined; } chunks.push(value); }
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { error?: unknown };
    return typeof value?.error === 'string' && /^[a-z_]{1,64}$/.test(value.error) ? value.error : undefined;
  } catch { return undefined; } finally { reader.releaseLock(); }
}

/** All credentials remain in main. Responses and redirects are bounded before use. */
export async function connectRequest(origin: string, path: string, credential?: string, body?: unknown, fetcher: ConnectFetch = fetch): Promise<Record<string, any>> {
  const response = await fetcher(`${origin}/api/connect${path}`, {
    method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(12_000),
    headers: { ...(credential ? { Authorization: `Bearer ${credential}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
  if (response.url && new URL(response.url).origin !== origin) throw new Error('Connect redirected to another service');
  if (!response.ok) throw new ConnectRequestError(response.status, await errorCode(response));
  if (!response.headers.get('content-type')?.includes('application/json')) { await response.body?.cancel(); throw new Error('This address is not a Connect service'); }
  const reader = response.body?.getReader(); if (!reader) throw new Error('Empty Connect response');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 262_144) { await reader.cancel(); throw new Error('Connect response too large'); } chunks.push(value); }
  } finally { reader.releaseLock(); }
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Connect response');
  return value;
}

export class ConnectEnrollment {
  private pending?: EnrollmentView & { deviceCode: string; origin: string };
  constructor(private readonly fetcher: ConnectFetch = fetch, private readonly now = Date.now) {}
  cancel() { this.pending = undefined; }
  async redeem(address: unknown, code: unknown): Promise<MobileConnectionInput> {
    if (typeof address !== 'string' || address.length > 2048) throw new Error('Enter the Connect HTTPS address');
    const url = new URL(address);
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Use an HTTPS origin without a path');
    if (typeof code !== 'string' || code.length > 80 || !/^[A-F0-9]{16}$/i.test(code.replace(/[\s-]/g, ''))) throw new Error('Enter the complete connect code from your account page');
    let result;
    try { result = await connectRequest(url.origin, '/computer/redeem', undefined, { code, name: hostname().slice(0, 80) }, this.fetcher); }
    catch (error) {
      if (error instanceof ConnectRequestError && [409, 410].includes(error.status)) throw new Error('This code expired, was already used, or the account is full. Check your account and get a new code.');
      throw error;
    }
    if (result.accountUrl !== url.origin) throw new Error('Invalid Connect account');
    return validateMobileConnection({ mode: 'connect', accountUrl: url.origin, serverId: result.serverId, publicUrl: result.serverUrl, relayToken: result.credential });
  }
  async start(address: unknown): Promise<EnrollmentView> {
    if (typeof address !== 'string' || address.length > 2048) throw new Error('Enter the Connect HTTPS address');
    const url = new URL(address);
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Use an HTTPS origin without a path');
    const result = await connectRequest(url.origin, '/device/start', undefined, { name: hostname().slice(0, 80) }, this.fetcher);
    const verification = new URL(result.verificationUrl);
    if (verification.origin !== url.origin || verification.pathname !== '/connect/' || !/^[\w-]{43}$/.test(result.deviceCode) || !Number.isFinite(result.expiresAt) || result.expiresAt <= this.now() || result.expiresAt > this.now() + 15 * 60_000) throw new Error('Invalid enrollment response');
    this.pending = { origin: url.origin, deviceCode: result.deviceCode, verificationUrl: verification.href, expiresAt: result.expiresAt };
    return { verificationUrl: verification.href, expiresAt: result.expiresAt };
  }
  async poll(): Promise<MobileConnectionInput | null> {
    const pending = this.pending;
    if (!pending || pending.expiresAt <= this.now()) { this.cancel(); throw new Error('Sign-in expired. Start again.'); }
    const result = await connectRequest(pending.origin, '/device/poll', undefined, { deviceCode: pending.deviceCode }, this.fetcher);
    if (this.pending !== pending) throw new Error('Sign-in cancelled');
    if (result.pending === true) return null;
    if (result.accountUrl !== pending.origin) throw new Error('Invalid Connect account');
    const value = validateMobileConnection({ mode: 'connect', accountUrl: pending.origin, serverId: result.serverId, publicUrl: result.serverUrl, relayToken: result.credential });
    return value;
  }
}
