import { describe, it, expect, vi, beforeEach } from 'vitest';
import { existsSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const testHome = '/tmp/test-zcc-secrets-' + process.pid;
const testDataDir = join(testHome, '.zcc');
const testSecretsFile = join(testDataDir, 'voice-secrets.enc');

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => testHome) },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((plain: string) => Buffer.from(`enc:${plain}`, 'utf8')),
    decryptString: vi.fn((enc: Buffer) => enc.toString('utf8').replace(/^enc:/, ''))
  }
}));

describe('voice secrets storage', () => {
  beforeEach(async () => {
    if (existsSync(testSecretsFile)) rmSync(testSecretsFile);
    if (!existsSync(testDataDir)) mkdirSync(testDataDir, { recursive: true });
    // Keep env-fallback tests deterministic regardless of the host environment.
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    // Reset the safeStorage mock so one test's "unavailable" state can't leak.
    const { safeStorage } = await import('electron');
    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);
    // Re-import fresh each test to reset module state
    vi.resetModules();
  });

  it('returns null when no key is configured', async () => {
    const { getOpenAiKey, hasOpenAiKey } = await import('../secrets.js');
    expect(hasOpenAiKey()).toBe(false);
    expect(getOpenAiKey()).toBeNull();
  });

  it('stores and retrieves the key via encryption', async () => {
    const { setOpenAiKey, getOpenAiKey, hasOpenAiKey } = await import('../secrets.js');
    setOpenAiKey('sk-test-key-12345');
    expect(hasOpenAiKey()).toBe(true);
    expect(getOpenAiKey()).toBe('sk-test-key-12345');
  });

  it('never writes the plaintext key to disk', async () => {
    const { setOpenAiKey } = await import('../secrets.js');
    const testKey = 'sk-secret-plaintext';
    setOpenAiKey(testKey);
    const diskContent = readFileSync(testSecretsFile, 'utf8');
    // The disk should contain base64 of "enc:sk-secret-plaintext", not the raw key
    expect(diskContent).not.toContain(testKey);
    expect(diskContent).toContain('openai');
  });

  it('returns null when safeStorage is unavailable and no env key is set', async () => {
    const { safeStorage } = await import('electron');
    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false);
    const { getOpenAiKey } = await import('../secrets.js');
    expect(getOpenAiKey()).toBeNull();
  });

  it('falls back to OPENAI_API_KEY when no stored key exists', async () => {
    process.env.OPENAI_API_KEY = 'sk-env-key';
    const { getOpenAiKey, hasOpenAiKey } = await import('../secrets.js');
    expect(hasOpenAiKey()).toBe(true);
    expect(getOpenAiKey()).toBe('sk-env-key');
  });

  it('prefers a stored OpenAI key over the env var', async () => {
    process.env.OPENAI_API_KEY = 'sk-env-key';
    const { setOpenAiKey, getOpenAiKey } = await import('../secrets.js');
    setOpenAiKey('sk-stored-key');
    expect(getOpenAiKey()).toBe('sk-stored-key');
  });

  it('resolves a Gemini key from GEMINI_API_KEY or GOOGLE_API_KEY', async () => {
    process.env.GOOGLE_API_KEY = 'g-key';
    const { getGeminiKey, hasGeminiKey } = await import('../secrets.js');
    expect(hasGeminiKey()).toBe(true);
    expect(getGeminiKey()).toBe('g-key');
  });

  it('stores and retrieves a Gemini key via encryption', async () => {
    const { setGeminiKey, getGeminiKey } = await import('../secrets.js');
    setGeminiKey('g-stored');
    expect(getGeminiKey()).toBe('g-stored');
  });
});
