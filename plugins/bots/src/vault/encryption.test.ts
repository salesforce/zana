import { randomBytes } from 'node:crypto';
import { it, expect } from 'vitest';
import { open, seal } from './encryption';

it('rejects oversized data and authenticates the storage purpose and envelope', () => {
  const key = randomBytes(32);
  const purpose = Buffer.from('saved items');
  const envelope = seal(['entry'], key, '', purpose);
  expect(open(envelope, key, purpose)).toEqual(['entry']);
  expect(() => open(envelope, key, Buffer.from('wrapped key'))).toThrow();
  expect(() => open({ ...envelope, data: 'x'.repeat(3 * 1024 * 1024 + 1) }, key, purpose)).toThrow();
  expect(() => seal(['x'.repeat(2 * 1024 * 1024)], key, '', purpose)).toThrow('full');
});

it('requires the full 16-byte authentication tag when reading a saved vault', () => {
  const key = randomBytes(32);
  const purpose = Buffer.from('saved items');
  const envelope = seal(['entry'], key, '', purpose);
  const tag = Buffer.from(envelope.tag, 'base64');
  expect(tag.length).toBe(16);
  const truncated = { ...envelope, tag: tag.subarray(0, 12).toString('base64') };
  expect(() => open(truncated, key, purpose)).toThrow('Could not decrypt');
});
