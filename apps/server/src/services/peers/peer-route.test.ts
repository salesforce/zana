import { expect, it } from 'vitest';
import { PEER_ROUTE_MAX, validatePeerRoute } from './peer-route.js';

it('accepts only loopback origins or explicitly allowlisted https origins and normalizes to the origin', () => {
  expect(validatePeerRoute('http://127.0.0.1:4100')).toBe('http://127.0.0.1:4100/');
  expect(validatePeerRoute('http://localhost:4100/')).toBe('http://localhost:4100/');
  expect(validatePeerRoute('http://[::1]:4100/')).toBe('http://[::1]:4100/');
  expect(validatePeerRoute('https://127.0.0.1/')).toBe('https://127.0.0.1/');
  expect(validatePeerRoute('https://peer.example/', ['https://peer.example'])).toBe('https://peer.example/');
  expect(validatePeerRoute('https://PEER.example:443/', ['https://peer.example'])).toBe('https://peer.example/');
});

it.each([
  ['non-string', 42], ['empty', ''], ['too long', `http://127.0.0.1/${'a'.repeat(PEER_ROUTE_MAX)}`], ['unparseable', 'not a url'],
  ['protocol', 'ftp://127.0.0.1/'], ['file', 'file:///etc/passwd'], ['credentials', 'http://user:pass@127.0.0.1/'], ['username', 'http://user@127.0.0.1/'],
  ['path', 'http://127.0.0.1/api'], ['query', 'http://127.0.0.1/?a=1'], ['hash', 'http://127.0.0.1/#x']
])('rejects %s routes as invalid', (_name, input) => {
  expect(() => validatePeerRoute(input)).toThrow('invalid peer route');
});

it.each([
  ['public http', 'http://peer.example/', []], ['unlisted https', 'https://peer.example/', []],
  ['allowlisted but http', 'http://peer.example/', ['http://peer.example']], ['lookalike', 'https://peer.example.evil/', ['https://peer.example']],
  ['other port', 'https://peer.example:8443/', ['https://peer.example']], ['private address', 'http://10.0.0.5/', []], ['zero address', 'http://0.0.0.0:4100/', []]
] as const)('rejects %s destinations', (_name, input, allowed) => {
  expect(() => validatePeerRoute(input, allowed)).toThrow('peer route is not loopback or allowlisted');
});
