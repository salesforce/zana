import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { resolveZccDataDir } from './host-config.js';

const SECRET_BYTES = 32;

export function createControlCredentialSigner(options: {
  secretPath?: string;
  randomSecret?: () => Buffer;
}) {
  let secret: Buffer | undefined;
  const getSecret = (): Buffer => {
    if (secret) return secret;
    if (options.secretPath && existsSync(options.secretPath)) {
      chmodSync(options.secretPath, 0o600);
      const stored = readFileSync(options.secretPath);
      if (stored.length !== SECRET_BYTES) throw new Error('Invalid control credential signing secret');
      secret = stored;
      return secret;
    }

    const created = options.randomSecret?.() ?? randomBytes(SECRET_BYTES);
    if (created.length !== SECRET_BYTES) throw new Error('Invalid control credential signing secret length');
    if (!options.secretPath) {
      secret = created;
      return secret;
    }
    const dir = dirname(options.secretPath);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const tmp = `${options.secretPath}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`;
    writeFileSync(tmp, created, { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, options.secretPath);
    secret = created;
    return secret;
  };

  return {
    credentialForSession(sessionId: string): string {
      return createHmac('sha256', getSecret()).update(sessionId, 'utf8').digest('hex');
    },
    verifySessionCredential(sessionId: string, credential: unknown): boolean {
      if (typeof credential !== 'string') return false;
      const expected = this.credentialForSession(sessionId);
      const actual = Buffer.from(credential, 'utf8');
      const wanted = Buffer.from(expected, 'utf8');
      return actual.length === wanted.length && timingSafeEqual(actual, wanted);
    }
  };
}

// Tests use one process-local signer unless they explicitly construct a durable
// signer. Production persists one owner-only per-install key so tmux sessions
// remain authenticated across app restarts without receiving signing material.
const signer = createControlCredentialSigner({
  ...(process.env.NODE_ENV === 'test'
    ? { randomSecret: () => randomBytes(SECRET_BYTES) }
    : { secretPath: join(resolveZccDataDir(), 'control-signing.key') })
});

export function controlCredentialForSession(sessionId: string): string {
  return signer.credentialForSession(sessionId);
}

export function verifySessionControlCredential(sessionId: string, credential: unknown): boolean {
  return signer.verifySessionCredential(sessionId, credential);
}
