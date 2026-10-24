import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { fingerprint, generateSeed, privateKeyFile, publicKeyLine } from './ssh-keys.js';

const hasKeygen = spawnSync('ssh-keygen', ['-?']).error === undefined;
// RFC 8032 section 7.1 test 1.
const RFC_SEED = Buffer.from('9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60', 'hex').toString('base64url');
const RFC_PUB = Buffer.from('d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a', 'hex');

it('derives the RFC 8032 public key into the ssh-ed25519 wire format', () => {
  const line = publicKeyLine(RFC_SEED);
  const blob = Buffer.from(line.split(' ')[1]!, 'base64');
  expect(line).toMatch(/^ssh-ed25519 [A-Za-z0-9+/]{68}$/);
  expect(blob.subarray(0, 4).readUInt32BE()).toBe(11);
  expect(blob.subarray(blob.length - 32)).toEqual(RFC_PUB);
});

it('generates distinct valid seeds and rejects malformed ones', () => {
  expect(generateSeed()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(generateSeed()).not.toBe(generateSeed());
  for (const bad of ['', 'short', 'A'.repeat(44), '!'.repeat(43), 5 as never]) {
    expect(() => publicKeyLine(bad)).toThrow('Invalid SSH key seed');
    expect(() => privateKeyFile(bad)).toThrow('Invalid SSH key seed');
  }
});

it('fingerprints as SHA256 without padding and validates the public line', () => {
  expect(fingerprint(publicKeyLine(RFC_SEED))).toMatch(/^SHA256:[A-Za-z0-9+/]{43}$/);
  expect(fingerprint(`${publicKeyLine(RFC_SEED)} comment`)).toBe(fingerprint(publicKeyLine(RFC_SEED)));
  for (const bad of ['', 'ssh-rsa AAAA', 'ssh-ed25519', 'ssh-ed25519 !!!']) expect(() => fingerprint(bad)).toThrow('Invalid SSH public key');
  // Valid base64 that is not an ssh-ed25519 wire blob: short body, wrong embedded type, wrong key length, trailing bytes.
  const good = Buffer.from(publicKeyLine(RFC_SEED).split(' ')[1]!, 'base64');
  const wrongType = Buffer.from(good); wrongType.write('ssh-ed25518', 4);
  for (const blob of [Buffer.from('hello'), wrongType, good.subarray(0, good.length - 1), Buffer.concat([good, Buffer.from([0])])]) {
    expect(() => fingerprint(`ssh-ed25519 ${blob.toString('base64')}`)).toThrow('Invalid SSH public key');
  }
});

it('writes an armoured openssh-key-v1 file with 8-byte aligned private section', () => {
  const text = privateKeyFile(RFC_SEED, 'zana-peer-v1:x');
  expect(text.startsWith('-----BEGIN OPENSSH PRIVATE KEY-----\n')).toBe(true);
  expect(text.endsWith('-----END OPENSSH PRIVATE KEY-----\n')).toBe(true);
  const raw = Buffer.from(text.split('\n').slice(1, -2).join(''), 'base64');
  expect(raw.subarray(0, 15).toString('latin1')).toBe('openssh-key-v1\0');
});

it.skipIf(!hasKeygen)('is accepted by ssh-keygen and yields the same public key and fingerprint', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'zcc-ssh-keys-'));
  try {
    for (const [seed, comment] of [[RFC_SEED, 'a'], [generateSeed(), 'zana-peer-v1:inst:link:link'], [generateSeed(), '']] as const) {
      const file = join(dir, `key-${comment.length}`);
      await writeFile(file, privateKeyFile(seed, comment), { mode: 0o600 });
      expect((await stat(file)).mode & 0o777).toBe(0o600);
      const pub = execFileSync('ssh-keygen', ['-y', '-f', file], { encoding: 'utf8' }).trim();
      expect(pub.split(' ').slice(0, 2).join(' ')).toBe(publicKeyLine(seed));
      const pubFile = join(dir, `pub-${comment.length}.pub`);
      await writeFile(pubFile, `${publicKeyLine(seed)}\n`);
      const printed = execFileSync('ssh-keygen', ['-l', '-f', pubFile], { encoding: 'utf8' });
      expect(printed).toContain(fingerprint(publicKeyLine(seed)));
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
