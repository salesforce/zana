import { expect, it, vi } from 'vitest';
import { sharedBrowserOpen } from './shared-browser-open.js';

const selected = { id: 'owned', instanceId: 'instance', name: 'Work Mac', url: 'https://work.zana-ide.com', online: true };
const location = `${selected.url}/_connect/login?intent=1790000000000.${'i'.repeat(43)}`;
it('uses the existing account session and cookie-bound handoff for exactly the selected computer', async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ location }));
  expect(await sharedBrowserOpen(fetch, selected)).toBe(location);
  expect(fetch).toHaveBeenCalledExactlyOnceWith('https://zana-ide.com/api/connect/browser/open/', expect.objectContaining({
    method: 'POST', credentials: 'include', redirect: 'error', headers: { 'content-type': 'application/json', origin: 'https://zana-ide.com' },
    body: JSON.stringify({ serverId: 'owned' }), signal: expect.any(AbortSignal)
  }));
});
it.each([401, 403, 503])('reports failed authorization (%s) without opening a document', async status => {
  const fetch = vi.fn().mockResolvedValue(new Response('unavailable', { status }));
  await expect(sharedBrowserOpen(fetch, selected)).rejects.toThrow(status === 401 ? 'Sign in to your Zana account' : 'Could not connect');
});
it.each([
  null, {}, { location: 42 }, { location: 'https://evil.example/_connect/login?intent=x' },
  { location: location.replace('/_connect/login', '/') }, { location: location.replace('https:', 'http:') },
  { location: location.replace('https://', 'https://user@') }, { location: location + '#fragment' },
  { location: location + '&extra=1' }, { location: location + '&intent=forged' },
  { location: `${selected.url}/_connect/login?intent=invalid` }, { location: 'invalid' }
])('refuses malformed or unowned navigation %j', async result => {
  await expect(sharedBrowserOpen(vi.fn().mockResolvedValue(Response.json(result)), selected)).rejects.toThrow();
});
it('bounds the response and handles missing, malformed and failed response bodies', async () => {
  for (const response of [new Response(null), new Response('x'.repeat(4097)), new Response('{')]) {
    await expect(sharedBrowserOpen(vi.fn().mockResolvedValue(response), selected)).rejects.toThrow();
  }
  await expect(sharedBrowserOpen(vi.fn().mockRejectedValue(new Error('Network unavailable')), selected)).rejects.toThrow('Network unavailable');
});
