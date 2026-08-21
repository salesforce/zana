/**
 * Server-side signing helpers, matching the desktop client's verification
 * exactly (`apps/server/src/services/extensions/extension-registry.ts`) and `scripts/publish-extension.mjs`'s
 * existing signing convention — so a release signed here is installable by the
 * UNCHANGED engine:
 *   - `sha256Hex` mirrors the engine's own `sha256Hex` (lowercase hex).
 *   - `signEd25519` mirrors `publish-extension.mjs`'s `crypto.sign(null, bytes, key)`,
 *     which is exactly what `makeEd25519Verifier` verifies via
 *     `crypto.verify(null, data, publicKey, signature)`.
 *
 * `generateEd25519Keypair` is a test/local-setup convenience — it is NOT used
 * in the production signing path (the real private key lives only in the
 * `REGISTRY_SIGNING_KEY` env var, per design §4).
 */
import {
  createHash,
  sign as cryptoSign,
  createPrivateKey,
  generateKeyPairSync,
  type KeyLike
} from 'node:crypto';

/** Lowercase hex sha256 of `bytes` — the integrity gate the engine checks against `release.sha256`. */
export function sha256Hex(bytes: Uint8Array | Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Ed25519-sign `bytes` with `privateKeyPem` (pkcs8 PEM, or any `KeyLike` node:crypto
 * accepts), returning the base64 detached signature `makeEd25519Verifier` verifies via
 * `crypto.verify(null, data, publicKey, signature)`.
 */
export function signEd25519(bytes: Uint8Array | Buffer, privateKeyPem: string | Buffer | KeyLike): string {
  const privateKey =
    typeof privateKeyPem === 'string' || Buffer.isBuffer(privateKeyPem)
      ? createPrivateKey(privateKeyPem)
      : privateKeyPem;
  return cryptoSign(null, bytes, privateKey).toString('base64');
}

/** A generated Ed25519 keypair, PEM-encoded (spki public / pkcs8 private). */
export interface Ed25519KeyPairPem {
  publicKeyPem: string;
  privateKeyPem: string;
}

/**
 * Generate a fresh Ed25519 keypair for tests / local dev setup. Returns PEM
 * strings in the same encodings the design doc's env vars expect:
 * `REGISTRY_SIGNING_KEY` (private, pkcs8) / `REGISTRY_PUBLIC_KEY` (public, spki).
 */
export function generateEd25519Keypair(): Ed25519KeyPairPem {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  };
}
