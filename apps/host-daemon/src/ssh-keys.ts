import { createHash, createPrivateKey, createPublicKey, randomBytes } from 'node:crypto';

// Pure ed25519 helpers for peer-link SSH keys. A 32-byte seed deterministically yields the OpenSSH
// private key file, the `ssh-ed25519` public line and its fingerprint, so only the seed is stored.

const KEY_TYPE = 'ssh-ed25519';
const AUTH_MAGIC = 'openssh-key-v1\0';
/** PKCS#8 prefix of an ed25519 private key; the 32-byte seed follows. */
const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const SEED_RE = /^[A-Za-z0-9_-]{43}$/;

const u32 = (value: number): Buffer => { const out = Buffer.alloc(4); out.writeUInt32BE(value); return out; };
const sshString = (data: Buffer | string): Buffer => {
  const bytes = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
  return Buffer.concat([u32(bytes.length), bytes]);
};

export function generateSeed(): string {
  return randomBytes(32).toString('base64url');
}

function seedBytes(seed: string): Buffer {
  if (typeof seed !== 'string' || !SEED_RE.test(seed)) throw new Error('Invalid SSH key seed');
  const bytes = Buffer.from(seed, 'base64url');
  if (bytes.length !== 32) throw new Error('Invalid SSH key seed');
  return bytes;
}

function rawPublicKey(seed: Buffer): Buffer {
  const key = createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, seed]), format: 'der', type: 'pkcs8' });
  const x = createPublicKey(key).export({ format: 'jwk' }).x;
  const pub = Buffer.from(String(x), 'base64url');
  if (pub.length !== 32) throw new Error('Invalid SSH key seed');
  return pub;
}

function publicBlob(pub: Buffer): Buffer {
  return Buffer.concat([sshString(KEY_TYPE), sshString(pub)]);
}

/** `ssh-ed25519 <base64>` without a comment. */
export function publicKeyLine(seed: string): string {
  return `${KEY_TYPE} ${publicBlob(rawPublicKey(seedBytes(seed))).toString('base64')}`;
}

/** `SHA256:<base64 without padding>`, the form `ssh-keygen -l` prints. */
export function fingerprint(publicLine: string): string {
  const [type, body] = publicLine.trim().split(/\s+/);
  if (type !== KEY_TYPE || !body || !/^[A-Za-z0-9+/]+={0,2}$/.test(body)) throw new Error('Invalid SSH public key');
  const blob = Buffer.from(body, 'base64');
  // Canonical wire form: string "ssh-ed25519" then a 32-byte string, nothing else.
  const expected = publicBlob(Buffer.alloc(32));
  if (blob.length !== expected.length || !blob.subarray(0, expected.length - 32).equals(expected.subarray(0, expected.length - 32))
    || blob.toString('base64') !== body) {
    throw new Error('Invalid SSH public key');
  }
  return `SHA256:${createHash('sha256').update(blob).digest('base64').replace(/=+$/, '')}`;
}

/** An unencrypted `openssh-key-v1` private key file (PEM armoured) for `ssh -i`. */
export function privateKeyFile(seed: string, comment = 'zana-peer'): string {
  const secret = seedBytes(seed);
  const pub = rawPublicKey(secret);
  const check = randomBytes(4);
  const body = Buffer.concat([check, check, sshString(KEY_TYPE), sshString(pub), sshString(Buffer.concat([secret, pub])), sshString(comment)]);
  // Pad the private section to the (unencrypted) cipher block size of 8 with 1,2,3...
  const padding = Buffer.from(Array.from({ length: (8 - (body.length % 8)) % 8 }, (_, i) => i + 1));
  const blob = Buffer.concat([
    Buffer.from(AUTH_MAGIC, 'latin1'), sshString('none'), sshString('none'), sshString(''), u32(1),
    sshString(publicBlob(pub)), sshString(Buffer.concat([body, padding]))
  ]);
  const lines = blob.toString('base64').match(/.{1,70}/g) ?? [];
  return `-----BEGIN OPENSSH PRIVATE KEY-----\n${lines.join('\n')}\n-----END OPENSSH PRIVATE KEY-----\n`;
}
