import { expect, it } from 'vitest';
import { OrgLoginHistory } from '../lib/org-login-history.js';
it('recovers public completed sign-ins after reload, with project ownership and expiry', async () => {
  const data = new Map<string, unknown>();
  const kv = { get: async <T,>(key: string) => data.get(key) as T, set: async (key: string, value: unknown) => { data.set(key, value); } };
  let now = 0;
  const history = new OrgLoginHistory(kv, () => now);
  await Promise.all(Array.from({ length: 14 }, (_, i) => history.put(`j${i}`, 'p', { ok: false, error: 'Cancelled' })));
  const reloaded = new OrgLoginHistory(kv, () => now);
  expect(await reloaded.get('j0', 'p')).toBeUndefined();
  expect(await reloaded.get('j13', 'other')).toBeUndefined();
  expect(await reloaded.get('j13', 'p')).toEqual({ ok: false, error: 'Cancelled' });
  await reloaded.put('j13', 'p', { ok: true });
  expect(await reloaded.get('j13', 'p')).toEqual({ ok: true });
  await reloaded.put('large', null, { text: 'x'.repeat(500001) });
  expect(await reloaded.get('large', null)).toBeUndefined();
  now = 900000;
  expect(await reloaded.get('j13', 'p')).toBeUndefined();
});
it('recovers after a failed store and tolerates malformed stored data', async () => {
  let broken = true;
  let value: unknown = {};
  const history = new OrgLoginHistory({ get: async <T,>() => value as T, set: async (_key, data) => { if (broken) throw Error('disk'); value = data; } }, () => 100);
  await expect(history.put('j', null, {})).rejects.toThrow('disk');
  broken = false;
  await history.put('j', null, { ok: true });
  expect(await history.get('j', null)).toEqual({ ok: true });
});
