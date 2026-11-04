import { SHARED_ACCOUNT } from './shared-sign-in.js';
import type { SharedInstance } from './shared-target.js';

/** Complete the existing cookie-bound browser handoff in the isolated account session. */
export async function sharedBrowserOpen(fetch: (url: string, init: RequestInit) => Promise<Response>, selected: SharedInstance): Promise<string> {
  const response = await fetch(`${SHARED_ACCOUNT}/api/connect/browser/open/`, {
    method: 'POST', credentials: 'include', redirect: 'error', signal: AbortSignal.timeout(12_000),
    headers: { 'content-type': 'application/json', origin: SHARED_ACCOUNT }, body: JSON.stringify({ serverId: selected.id })
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(response.status === 401 ? 'Sign in to your Zana account, then refresh the instances.' : 'Could not connect to this computer. Check that it is awake and Zana is running, then try again.');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Empty computer connection response');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.length;
      if (size > 4096) { await reader.cancel(); throw new Error('Computer connection response too large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const result: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!result || typeof result !== 'object' || !('location' in result) || typeof result.location !== 'string') throw new Error('Invalid computer connection response');
  const url = new URL(result.location);
  // The account authorizes identity; its response cannot add another navigation origin.
  if (url.origin !== selected.url || url.username || url.password || url.hash || url.pathname !== '/_connect/login'
    || [...url.searchParams.keys()].length !== 1 || !/^\d{13}\.[\w-]{43}$/.test(url.searchParams.get('intent') ?? '')) throw new Error('Invalid computer connection address');
  return url.href;
}
