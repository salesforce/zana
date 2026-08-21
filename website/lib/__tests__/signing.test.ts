import { describe, it, expect } from 'vitest';
import { createHash, verify as cryptoVerify } from 'node:crypto';
import { sha256Hex, signEd25519, generateEd25519Keypair } from '../signing';

/**
 * Replicates `makeEd25519Verifier` from `apps/server/src/services/extensions/extension-registry.ts`
 * EXACTLY (`crypto.verify(null, data, publicKey, Buffer.from(signatureB64,'base64'))`)
 * so this test proves `signing.ts` produces signatures the UNCHANGED desktop
 * engine accepts, without importing across the worktree's package boundary.
 */
function verifyLikeEngine(data: Uint8Array, publicKeyPem: string, signatureB64: string): boolean {
  try {
    return cryptoVerify(null, data, publicKeyPem, Buffer.from(signatureB64, 'base64'));
  } catch {
    return false;
  }
}

describe('signing', () => {
  it('signs bytes and the engine-equivalent verifier accepts the signature', () => {
    const { publicKeyPem, privateKeyPem } = generateEd25519Keypair();
    const bytes = Buffer.from(JSON.stringify({ files: { 'extension.json': 'e30=' } }));

    const signature = signEd25519(bytes, privateKeyPem);

    expect(verifyLikeEngine(bytes, publicKeyPem, signature)).toBe(true);
  });

  it('rejects a signature over tampered bytes', () => {
    const { publicKeyPem, privateKeyPem } = generateEd25519Keypair();
    const bytes = Buffer.from(JSON.stringify({ files: { 'extension.json': 'e30=' } }));
    const tampered = Buffer.from(JSON.stringify({ files: { 'extension.json': 'e31=' } }));

    const signature = signEd25519(bytes, privateKeyPem);

    expect(verifyLikeEngine(tampered, publicKeyPem, signature)).toBe(false);
  });

  it('rejects a tampered signature over the original bytes', () => {
    const { publicKeyPem, privateKeyPem } = generateEd25519Keypair();
    const bytes = Buffer.from('hello world');

    const signature = signEd25519(bytes, privateKeyPem);
    const sigBuf = Buffer.from(signature, 'base64');
    sigBuf[0] ^= 0xff; // flip a bit
    const tamperedSignature = sigBuf.toString('base64');

    expect(verifyLikeEngine(bytes, publicKeyPem, tamperedSignature)).toBe(false);
  });

  it('sha256Hex matches an independent node:crypto computation, lowercase hex', () => {
    const bytes = Buffer.from('the quick brown fox jumps over the lazy dog');
    const expected = createHash('sha256').update(bytes).digest('hex');

    const actual = sha256Hex(bytes);

    expect(actual).toBe(expected);
    expect(actual).toBe(actual.toLowerCase());
    expect(actual).toMatch(/^[0-9a-f]{64}$/);
  });

  it('generateEd25519Keypair returns spki/pkcs8 PEM strings', () => {
    const { publicKeyPem, privateKeyPem } = generateEd25519Keypair();
    expect(publicKeyPem).toMatch(/^-----BEGIN PUBLIC KEY-----/);
    expect(privateKeyPem).toMatch(/^-----BEGIN PRIVATE KEY-----/);
  });
});
