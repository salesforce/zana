import { randomBytes } from 'node:crypto';
import { it, expect } from 'vitest';
import { open, seal } from './encryption';

it('rejects oversized data and authenticates the storage purpose and envelope', () => {
  const key = randomBytes(32);
  const purpose = Buffer.from('connections');
  const envelope = seal(['entry'], key, '', purpose);
  expect(open(envelope, key, purpose)).toEqual(['entry']);
  expect(() => open(envelope, key, Buffer.from('saved items'))).toThrow();
  expect(() => open({ ...envelope, data: 'x'.repeat(3 * 1024 * 1024 + 1) }, key, purpose)).toThrow();
  expect(() => seal(['x'.repeat(2 * 1024 * 1024)], key, '', purpose)).toThrow('full');
});
