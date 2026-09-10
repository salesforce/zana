import { app, safeStorage } from 'electron';
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { resolveZccDataDir } from '@zana-ai/zcc-host-daemon/host-config';

function dataDir(): string {
  return resolveZccDataDir(process.env, app.getPath('home'));
}
function secretsFile(): string {
  return join(dataDir(), 'voice-secrets.enc');
}

function ensureDir(): void {
  const dir = dataDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/**
 * `safeStorage.isEncryptionAvailable()`/`encryptString`/`decryptString` touch
 * the real OS Keychain on macOS (creating/reading the app's "Safe Storage" item),
 * which pops an interactive system consent prompt on first access. A headless
 * E2E runner (`ZCC_E2E_HOME` set — see `resume-token-store.ts`'s `insecure`
 * flag for the twin fix) has no one to click "Allow", so treat encryption as
 * unavailable there and fall through to the env-var fallback instead.
 */
function encryptionAvailable(): boolean {
  return !process.env.ZCC_E2E_HOME && safeStorage.isEncryptionAvailable();
}

interface SecretsBlob {
  openai?: string;
  gemini?: string;
}

function readSecretsBlob(): SecretsBlob {
  try {
    if (!existsSync(secretsFile())) return {};
    const raw = readFileSync(secretsFile(), 'utf8');
    return JSON.parse(raw) as SecretsBlob;
  } catch {
    return {};
  }
}

function writeSecretsBlob(blob: SecretsBlob): void {
  ensureDir();
  const payload = JSON.stringify(blob);
  const file = secretsFile();
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, payload, 'utf8');
  renameSync(tmp, file);
}

export function setOpenAiKey(key: string): void {
  if (!encryptionAvailable()) {
    throw new Error('Encryption unavailable — safeStorage not ready');
  }
  const encrypted = safeStorage.encryptString(key);
  const blob = readSecretsBlob();
  blob.openai = encrypted.toString('base64');
  writeSecretsBlob(blob);
}

export function getOpenAiKey(): string | null {
  if (encryptionAvailable()) {
    try {
      const blob = readSecretsBlob();
      if (blob.openai) {
        const encrypted = Buffer.from(blob.openai, 'base64');
        return safeStorage.decryptString(encrypted);
      }
    } catch {
      /* fall through to env */
    }
  }
  // Fallback: standard env var, so the key works headless / before a stored key
  // is set (e.g. CI, or LLM providers ahead of the settings-panel key UI).
  return process.env.OPENAI_API_KEY?.trim() || null;
}

export function hasOpenAiKey(): boolean {
  return !!readSecretsBlob().openai || !!process.env.OPENAI_API_KEY?.trim();
}

export function setGeminiKey(key: string): void {
  if (!encryptionAvailable()) {
    throw new Error('Encryption unavailable — safeStorage not ready');
  }
  const encrypted = safeStorage.encryptString(key);
  const blob = readSecretsBlob();
  blob.gemini = encrypted.toString('base64');
  writeSecretsBlob(blob);
}

export function getGeminiKey(): string | null {
  if (encryptionAvailable()) {
    try {
      const blob = readSecretsBlob();
      if (blob.gemini) {
        const encrypted = Buffer.from(blob.gemini, 'base64');
        return safeStorage.decryptString(encrypted);
      }
    } catch {
      /* fall through to env */
    }
  }
  // Fallback: standard env vars (Google SDK convention accepts either).
  return process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim() || null;
}

export function hasGeminiKey(): boolean {
  return (
    !!readSecretsBlob().gemini ||
    !!process.env.GEMINI_API_KEY?.trim() ||
    !!process.env.GOOGLE_API_KEY?.trim()
  );
}
