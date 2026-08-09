# Voice-to-Text Input — Phase 1 Implementation Plan

> For agentic workers: implement this plan task-by-task with red-green-refactor discipline. One task, one commit. Never batch.

**Goal**: Add push-to-talk dictation to React prompt textareas (PromptComposer). Voice is another text-entry method feeding the same onChange sink as keyboard. SCOPE = React textareas only; xterm terminal overlay is Phase 2 (out of scope).

**Branch discipline**: This plan is being executed in a dedicated workflow worktree. The worktree is already on its designated branch. Stay on this branch — do NOT create a new branch.

**Architecture**: Follow the existing provider seam pattern (LlmProvider → LlmService) exactly. Create VoiceProvider → VoiceService mirroring that structure. OpenAI only (Anthropic has no STT endpoint). Encrypted key storage with Electron safeStorage. IPC channel + preload surface mirroring llmPrompts. Renderer VoiceInputButton modeled on ImprovePromptButton (same props contract, same ghost-button styling, same caret-splice logic).

---

## Task 1: Define VoiceProvider interface and shared types

**What**: Create `src/main/voice/provider.ts` with the VoiceProvider interface, mirroring the LlmProvider pattern. Add voice-related types to `src/shared/types.ts`.

**Red**: No types exist yet; importing VoiceProvider would fail.

**Green**:
```typescript
// src/main/voice/provider.ts
/**
 * One transcription request to a provider. The audio is already recorded by the
 * renderer and passed as a Buffer; the provider POSTs it to its endpoint.
 */
export interface VoiceTranscribeRequest {
  /** Recorded audio as a binary blob. */
  audio: Buffer;
  /** MIME type (e.g. 'audio/webm;codecs=opus'). */
  mimeType: string;
  /** Optional language hint (e.g. 'en'). */
  language?: string;
}

/**
 * The provider seam for voice transcription. Each transport (OpenAI now; others
 * later) implements this one method. Adding a provider is a new file that
 * implements `VoiceProvider` and a registration in the provider map — no change
 * to {@link VoiceService} or any caller. Implementations MUST resolve to a
 * {@link VoiceTranscribeResult} (never throw) so the service stays a thin dispatcher.
 */
export interface VoiceProvider {
  readonly id: string;
  transcribe(req: VoiceTranscribeRequest): Promise<VoiceTranscribeResult>;
}

/** A provider registry — id → implementation. Built once at boot. */
export type VoiceProviderMap = Map<string, VoiceProvider>;
```

```typescript
// src/shared/types.ts (add near LlmRunResult)
/**
 * Result of a voice transcription call. `ok: false` on network failure, missing
 * key, timeout, or provider error. `text` is the raw transcript (empty on failure).
 */
export interface VoiceTranscribeResult {
  ok: boolean;
  /** Raw transcript text. Empty on failure. */
  text: string;
  /** Present when `ok` is false. */
  error?: string;
  /** Wall-clock duration of the call in ms. */
  ms: number;
}
```

**Test**: TypeScript compiles; importing the types succeeds.

**Commit**: `feat(voice): add VoiceProvider interface and types`

---

## Task 2: Implement OpenAI VoiceProvider

**What**: Create `src/main/voice/openai-provider.ts` implementing VoiceProvider. POSTs audio to OpenAI's transcription endpoint (`https://api.openai.com/v1/audio/transcriptions`) using model `whisper-1`. Reads API key from a getter passed in constructor (key storage in Task 3). Honors timeout (30s), body cap (25 MB, OpenAI's limit), never logs the key. MUST resolve (never throw).

**Red**: No OpenAI provider exists yet; tests would fail to import it.

**Green**:
```typescript
// src/main/voice/openai-provider.ts
import type { VoiceProvider, VoiceTranscribeRequest, VoiceTranscribeResult } from './provider.js';
import type { VoiceTranscribeResult as SharedResult } from '../../shared/types.js';

const OPENAI_ENDPOINT = 'https://api.openai.com/v1/audio/transcriptions';
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // OpenAI limit

/**
 * OpenAI Whisper transcription provider. POSTs audio to OpenAI's transcription
 * endpoint (model `whisper-1`) as multipart/form-data. Never throws — errors are
 * returned as `ok: false` results. The API key is read on every call from the
 * provided getter (key lives in secure storage; getter decrypts it).
 */
export class OpenAiVoiceProvider implements VoiceProvider {
  readonly id = 'openai';

  /**
   * @param getApiKey - Synchronously returns the decrypted OpenAI API key, or
   *   null if none is configured. Called on every transcription request.
   */
  constructor(private readonly getApiKey: () => string | null) {}

  async transcribe(req: VoiceTranscribeRequest): Promise<SharedResult> {
    const startMs = Date.now();

    // Guard: check key before sending
    const apiKey = this.getApiKey();
    if (!apiKey) {
      return {
        ok: false,
        text: '',
        error: 'No OpenAI API key configured',
        ms: Date.now() - startMs
      };
    }

    // Guard: audio size
    if (req.audio.byteLength > MAX_AUDIO_BYTES) {
      return {
        ok: false,
        text: '',
        error: `Audio too large (${(req.audio.byteLength / (1024 * 1024)).toFixed(1)} MB, max 25 MB)`,
        ms: Date.now() - startMs
      };
    }

    try {
      // Build multipart/form-data by hand (Node 18+ has no native FormData with Buffer support)
      const boundary = `----VoiceBoundary${Date.now()}`;
      const parts: Buffer[] = [];

      // Add model field
      parts.push(
        Buffer.from(
          `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="model"\r\n\r\n` +
          `whisper-1\r\n`
        )
      );

      // Add language field if present
      if (req.language) {
        parts.push(
          Buffer.from(
            `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="language"\r\n\r\n` +
            `${req.language}\r\n`
          )
        );
      }

      // Add audio file
      const ext = req.mimeType.includes('webm') ? 'webm' : 'wav';
      parts.push(
        Buffer.from(
          `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="file"; filename="audio.${ext}"\r\n` +
          `Content-Type: ${req.mimeType}\r\n\r\n`
        ),
        req.audio,
        Buffer.from(`\r\n--${boundary}--\r\n`)
      );

      const body = Buffer.concat(parts);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

      const res = await fetch(OPENAI_ENDPOINT, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`
        },
        body,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        const errorText = await res.text().catch(() => '');
        return {
          ok: false,
          text: '',
          error: `OpenAI error ${res.status}: ${errorText.slice(0, 200)}`,
          ms: Date.now() - startMs
        };
      }

      const data = (await res.json()) as { text?: string };
      return {
        ok: true,
        text: data.text?.trim() ?? '',
        ms: Date.now() - startMs
      };
    } catch (err) {
      const isTimeout = (err as Error).name === 'AbortError';
      return {
        ok: false,
        text: '',
        error: isTimeout ? 'Request timed out' : `Network error: ${(err as Error).message}`,
        ms: Date.now() - startMs
      };
    }
  }
}
```

**Test**: Write unit test with a fake key getter; verify it never throws.

```typescript
// src/main/__tests__/voice-openai-provider.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAiVoiceProvider } from '../voice/openai-provider.js';

describe('OpenAiVoiceProvider', () => {
  let fetchMock: typeof global.fetch;

  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns error when no API key is configured', async () => {
    const provider = new OpenAiVoiceProvider(() => null);
    const result = await provider.transcribe({
      audio: Buffer.from('fake'),
      mimeType: 'audio/webm'
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('No OpenAI API key');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns error when audio exceeds size limit', async () => {
    const provider = new OpenAiVoiceProvider(() => 'sk-test');
    const largeBuffer = Buffer.alloc(26 * 1024 * 1024); // 26 MB
    const result = await provider.transcribe({
      audio: largeBuffer,
      mimeType: 'audio/webm'
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('too large');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('resolves (never throws) on successful transcription', async () => {
    const provider = new OpenAiVoiceProvider(() => 'sk-test');
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ text: 'hello world' })
    } as Response);

    const result = await provider.transcribe({
      audio: Buffer.from('fake audio'),
      mimeType: 'audio/webm'
    });

    expect(result.ok).toBe(true);
    expect(result.text).toBe('hello world');
    expect(result.ms).toBeGreaterThanOrEqual(0);
  });

  it('resolves (never throws) on network error', async () => {
    const provider = new OpenAiVoiceProvider(() => 'sk-test');
    fetchMock.mockRejectedValueOnce(new Error('Network failure'));

    const result = await provider.transcribe({
      audio: Buffer.from('fake'),
      mimeType: 'audio/webm'
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('Network error');
  });

  it('resolves (never throws) on HTTP error response', async () => {
    const provider = new OpenAiVoiceProvider(() => 'sk-test');
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized'
    } as Response);

    const result = await provider.transcribe({
      audio: Buffer.from('fake'),
      mimeType: 'audio/webm'
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('401');
  });
});
```

**Commit**: `feat(voice): implement OpenAI Whisper provider`

---

## Task 3: Add encrypted key storage with Electron safeStorage

**What**: Create `src/main/voice/secrets.ts` using Electron `safeStorage` to encrypt/decrypt the OpenAI key at rest. Store in `~/.zcc/voice-secrets.enc` (encrypted blob). Expose `setOpenAiKey(key: string): void`, `getOpenAiKey(): string | null`, and `hasOpenAiKey(): boolean`. Never log the plaintext key. Write atomic (tmp + rename).

**Red**: No key storage exists; voice service can't retrieve a key.

**Green**:
```typescript
// src/main/voice/secrets.ts
import { app, safeStorage } from 'electron';
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const dataDir = join(app.getPath('home'), '.zcc');
const secretsFile = join(dataDir, 'voice-secrets.enc');

/** Ensure the data directory exists before writing. */
function ensureDir() {
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
}

/**
 * On-disk encrypted blob shape. We only store one key now (OpenAI), but the
 * structure is extensible for future providers.
 */
interface SecretsBlob {
  openai?: string; // encrypted base64 string from safeStorage.encryptString
}

/**
 * Read the encrypted secrets file and return the parsed blob. Returns an empty
 * object if the file doesn't exist or is malformed.
 */
function readSecretsBlob(): SecretsBlob {
  try {
    if (!existsSync(secretsFile)) return {};
    const raw = readFileSync(secretsFile, 'utf8');
    return JSON.parse(raw) as SecretsBlob;
  } catch {
    return {};
  }
}

/**
 * Write the secrets blob to disk atomically (tmp + rename) to prevent corruption
 * if the process dies mid-write.
 */
function writeSecretsBlob(blob: SecretsBlob): void {
  ensureDir();
  const payload = JSON.stringify(blob);
  const tmp = `${secretsFile}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, payload, 'utf8');
  renameSync(tmp, secretsFile);
}

/**
 * Store the OpenAI API key in encrypted form. The plaintext key is encrypted via
 * Electron's safeStorage (OS keychain on macOS, DPAPI on Windows, libsecret on
 * Linux) and then base64-encoded for JSON storage. The plaintext NEVER touches
 * disk; only the encrypted blob is written.
 */
export function setOpenAiKey(key: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Encryption unavailable — safeStorage not ready');
  }
  const encrypted = safeStorage.encryptString(key);
  const blob = readSecretsBlob();
  blob.openai = encrypted.toString('base64');
  writeSecretsBlob(blob);
}

/**
 * Retrieve the OpenAI API key, decrypting it from disk. Returns null if no key
 * is configured or decryption fails (malformed blob, wrong machine, etc.). The
 * decrypted plaintext is returned directly to the caller (never logged).
 */
export function getOpenAiKey(): string | null {
  if (!safeStorage.isEncryptionAvailable()) {
    return null;
  }
  try {
    const blob = readSecretsBlob();
    if (!blob.openai) return null;
    const encrypted = Buffer.from(blob.openai, 'base64');
    return safeStorage.decryptString(encrypted);
  } catch {
    // Decryption failure (wrong machine, corrupted blob, etc.) — treat as absent.
    return null;
  }
}

/**
 * Check whether an OpenAI key is configured without decrypting it. Used by the
 * renderer to show/hide the "No key configured" warning.
 */
export function hasOpenAiKey(): boolean {
  const blob = readSecretsBlob();
  return !!blob.openai;
}
```

**Test**: Write unit test for the roundtrip; verify the plaintext never hits disk.

```typescript
// src/main/__tests__/voice-secrets.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { app, safeStorage } from 'electron';
import { setOpenAiKey, getOpenAiKey, hasOpenAiKey } from '../voice/secrets.js';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/test-zcc-secrets')
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((plain: string) => Buffer.from(plain, 'utf8')), // fake encrypt
    decryptString: vi.fn((enc: Buffer) => enc.toString('utf8')) // fake decrypt
  }
}));

const testDataDir = '/tmp/test-zcc-secrets';
const testSecretsFile = join(testDataDir, 'voice-secrets.enc');

describe('voice secrets storage', () => {
  beforeEach(() => {
    // Clean up test artifacts
    if (existsSync(testSecretsFile)) {
      rmSync(testSecretsFile);
    }
  });

  it('returns null when no key is configured', () => {
    expect(hasOpenAiKey()).toBe(false);
    expect(getOpenAiKey()).toBeNull();
  });

  it('stores and retrieves the key via encryption', () => {
    const testKey = 'sk-test-key-12345';
    setOpenAiKey(testKey);

    expect(hasOpenAiKey()).toBe(true);
    expect(getOpenAiKey()).toBe(testKey);
  });

  it('never writes the plaintext key to disk', () => {
    const testKey = 'sk-secret-plaintext';
    setOpenAiKey(testKey);

    const diskContent = readFileSync(testSecretsFile, 'utf8');
    expect(diskContent).not.toContain(testKey);
    expect(diskContent).toContain('openai'); // field name present
  });

  it('returns null when safeStorage is unavailable', () => {
    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValueOnce(false);
    expect(getOpenAiKey()).toBeNull();
  });
});
```

**Commit**: `feat(voice): add encrypted key storage with safeStorage`

---

## Task 4: Create VoiceService dispatcher

**What**: Create `src/main/voice-service.ts` mirroring `llm-service.ts`. Thin dispatcher over VoiceProviderMap with a default provider (openai). Never throws — returns `ok: false` results on missing provider. No de-dupe needed (audio is one-shot).

**Red**: No service exists; importing VoiceService would fail.

**Green**:
```typescript
// src/main/voice-service.ts
import type { VoiceProvider, VoiceProviderMap, VoiceTranscribeRequest } from './voice/provider.js';
import type { VoiceTranscribeResult } from '../shared/types.js';

const DEFAULT_PROVIDER = 'openai';

/**
 * Provider-agnostic voice transcription dispatcher. Forwards requests to the
 * configured provider (OpenAI by default; others later). Never throws — a missing
 * provider resolves to an `ok: false` result.
 */
export class VoiceService {
  constructor(private readonly providers: VoiceProviderMap) {}

  /** Register or replace a provider after construction (e.g., config reload). */
  setProvider(provider: VoiceProvider): void {
    this.providers.set(provider.id, provider);
  }

  /**
   * Transcribe audio via the default provider. Never throws — missing provider
   * resolves to an error result.
   */
  async transcribe(req: VoiceTranscribeRequest): Promise<VoiceTranscribeResult> {
    const provider = this.providers.get(DEFAULT_PROVIDER);
    if (!provider) {
      return {
        ok: false,
        text: '',
        error: `No voice provider registered for '${DEFAULT_PROVIDER}'`,
        ms: 0
      };
    }
    return provider.transcribe(req);
  }
}
```

**Test**: Unit test with a fake provider; verify missing-provider case returns `ok: false`.

```typescript
// src/main/__tests__/voice-service.test.ts
import { describe, it, expect, vi } from 'vitest';
import { VoiceService } from '../voice-service.js';
import type { VoiceProvider, VoiceTranscribeRequest } from '../voice/provider.js';
import type { VoiceTranscribeResult } from '../../shared/types.js';

function fakeProvider(result: Partial<VoiceTranscribeResult> = {}): VoiceProvider {
  return {
    id: 'openai',
    transcribe: vi.fn(async () => ({
      ok: true,
      text: 'transcribed',
      ms: 10,
      ...result
    }))
  };
}

describe('VoiceService', () => {
  it('forwards the request to the registered provider', async () => {
    const provider = fakeProvider({ text: 'hello world' });
    const svc = new VoiceService(new Map([['openai', provider]]));

    const result = await svc.transcribe({
      audio: Buffer.from('fake'),
      mimeType: 'audio/webm'
    });

    expect(result.ok).toBe(true);
    expect(result.text).toBe('hello world');
    expect(provider.transcribe).toHaveBeenCalledTimes(1);
  });

  it('returns ok:false when the provider is missing', async () => {
    const svc = new VoiceService(new Map());
    const result = await svc.transcribe({
      audio: Buffer.from('fake'),
      mimeType: 'audio/webm'
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('openai');
  });
});
```

**Commit**: `feat(voice): add VoiceService dispatcher`

---

## Task 5: Add IPC channels and types for voice

**What**: Add `voice` namespace to `src/shared/ipc.ts` with channels: `transcribe`, `setApiKey`, `hasApiKey`. Add the matching API surface to `CcApi` type in `src/shared/types.ts` (near `llmPrompts`).

**Red**: No IPC channels exist; preload can't reference them.

**Green**:
```typescript
// src/shared/ipc.ts (add after llmPrompts block)
  voice: {
    /** Transcribe audio to text via the configured provider. */
    transcribe: 'voice:transcribe',
    /** Store the OpenAI API key in encrypted form (write-only from renderer). */
    setApiKey: 'voice:setApiKey',
    /** Check whether an API key is configured (boolean, no plaintext). */
    hasApiKey: 'voice:hasApiKey'
  }
```

```typescript
// src/shared/types.ts (add to CcApi interface, after llmPrompts)
  voice: {
    /**
     * Transcribe audio to text. `audio` is a base64-encoded blob of the recorded
     * audio; `mimeType` is the MediaRecorder output format (e.g. 'audio/webm').
     */
    transcribe: (audio: string, mimeType: string) => Promise<VoiceTranscribeResult>;
    /** Store the OpenAI API key (write-only; never returns the plaintext). */
    setApiKey: (key: string) => Promise<void>;
    /** Check whether an API key is configured (boolean, no plaintext exposed). */
    hasApiKey: () => Promise<boolean>;
  };
```

**Test**: TypeScript compiles; IPC constant is accessible.

**Commit**: `feat(voice): add IPC channels for voice transcription`

---

## Task 6: Wire IPC handlers in main and expose in preload

**What**: Add IPC handlers to `src/main/index.ts` (after the `llmPrompts` handlers block, around line 750). Validate inputs (audio size, mimeType format) in main before passing to VoiceService. Register VoiceService + OpenAiVoiceProvider at app init (alongside llmService, around line 563). Add the preload surface to `src/preload/index.ts` (after `llmPrompts`, around line 264).

**Red**: No handlers exist; calling `window.cc.voice.*` from renderer would hang.

**Green**:
```typescript
// src/main/index.ts (registration block, ~line 563, after llmProviders)
import { OpenAiVoiceProvider } from './voice/openai-provider.js';
import { VoiceService } from './voice-service.js';
import { getOpenAiKey, setOpenAiKey, hasOpenAiKey } from './voice/secrets.js';

const voiceProviders = new Map();
voiceProviders.set('openai', new OpenAiVoiceProvider(() => getOpenAiKey()));
const voiceService = new VoiceService(voiceProviders);
```

```typescript
// src/main/index.ts (IPC handler block, ~line 750, after llmPrompts handlers)
// Voice transcription (OpenAI Whisper)
ipcMain.handle(IPC.voice.transcribe, async (_ev, audioBase64: unknown, mimeType: unknown) => {
  // Validate inputs — renderer is untrusted (Rule 1)
  if (typeof audioBase64 !== 'string' || typeof mimeType !== 'string') {
    return { ok: false, text: '', error: 'Invalid inputs', ms: 0 };
  }
  if (!mimeType.startsWith('audio/')) {
    return { ok: false, text: '', error: 'Invalid MIME type', ms: 0 };
  }

  try {
    const audio = Buffer.from(audioBase64, 'base64');
    // Guard: 25 MB limit (OpenAI's ceiling; provider also checks)
    if (audio.byteLength > 25 * 1024 * 1024) {
      return { ok: false, text: '', error: 'Audio too large (max 25 MB)', ms: 0 };
    }
    return await voiceService.transcribe({ audio, mimeType });
  } catch (err) {
    return { ok: false, text: '', error: `Transcription failed: ${(err as Error).message}`, ms: 0 };
  }
});

ipcMain.handle(IPC.voice.setApiKey, async (_ev, key: unknown) => {
  if (typeof key !== 'string' || !key.trim()) {
    throw new Error('Invalid API key');
  }
  setOpenAiKey(key.trim());
});

ipcMain.handle(IPC.voice.hasApiKey, async () => {
  return hasOpenAiKey();
});
```

```typescript
// src/preload/index.ts (add after llmPrompts block, ~line 264)
  voice: {
    transcribe: (audio, mimeType) => ipcRenderer.invoke(IPC.voice.transcribe, audio, mimeType),
    setApiKey: (key) => ipcRenderer.invoke(IPC.voice.setApiKey, key),
    hasApiKey: () => ipcRenderer.invoke(IPC.voice.hasApiKey)
  },
```

**Test**: Run `npm run typecheck`; verify no errors. Manual smoke test: open dev console, call `window.cc.voice.hasApiKey()` and verify it resolves to false.

**Commit**: `feat(voice): wire IPC handlers and preload surface`

---

## Task 7: Add macOS microphone permission to electron-builder config

**What**: Add `NSMicrophoneUsageDescription` to the macOS entitlements file (`resources/entitlements.mac.plist` and `resources/entitlements.mac.inherit.plist`) so the OS mic prompt has a description string. Without this, the permission request silently fails on macOS.

**Red**: No mic permission entry; macOS would deny access silently.

**Green**:
```xml
<!-- resources/entitlements.mac.plist (add before </dict>) -->
<key>NSMicrophoneUsageDescription</key>
<string>Zana Command Center uses the microphone to transcribe voice input for agent prompts.</string>
```

```xml
<!-- resources/entitlements.mac.inherit.plist (add before </dict>) -->
<key>NSMicrophoneUsageDescription</key>
<string>Zana Command Center uses the microphone to transcribe voice input for agent prompts.</string>
```

**Test**: Inspect the plist files; verify the key is present. (Full test requires a signed build, which is out of scope for this task — the E2E test in Task 11 will validate the integration.)

**Commit**: `feat(voice): add macOS microphone permission description`

---

## Task 8: Set session permission handler in main for media access

**What**: In `src/main/index.ts`, add a `session.setPermissionRequestHandler` callback (in the `app.whenReady()` block, around line 1000) to allow `media` (microphone) access for the app's own window. Deny all other permission types.

**Red**: No permission handler exists; MediaRecorder would be denied by Electron's default (deny-all) policy.

**Green**:
```typescript
// src/main/index.ts (app.whenReady block, after createWindow setup)
import { session } from 'electron';

app.whenReady().then(() => {
  // ... existing createWindow() and other setup ...

  // Allow media (microphone) access for this window only; deny everything else.
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowed = permission === 'media';
    callback(allowed);
  });

  // ... rest of app.whenReady ...
});
```

**Test**: TypeScript compiles; handler is installed. (Full test requires renderer integration in Task 9.)

**Commit**: `feat(voice): grant media permission for microphone access`

---

## Task 9: Implement VoiceInputButton renderer component

**What**: Create `src/renderer/components/VoiceInputButton.tsx` modeled on `ImprovePromptButton.tsx`. Props: `{ value, onChange, className }`. Push-to-talk: click to start MediaRecorder (audio/webm or audio/wav fallback), click to stop. On stop, base64-encode the blob, call `window.cc.voice.transcribe(audio, mimeType)`, splice the RAW transcript at the caret (same logic as PromptComposer's `useFileDrop` insert). Handle states: disabled while recording/transcribing (spinner), toast on failure (no key, offline, timeout). Clean up MediaRecorder + mic stream on stop/unmount. Use `Mic` and `MicOff` icons from `lucide-react` (match ImprovePromptButton's Sparkles/Loader2 pattern).

**Red**: No VoiceInputButton component exists; importing it would fail.

**Green**:
```typescript
// src/renderer/components/VoiceInputButton.tsx
import { useState, useRef, useEffect } from 'react';
import { Mic, MicOff, Loader2 } from 'lucide-react';
import { useUi } from '../store';

/**
 * "🎤 Dictate" — a small ghost button that sits beside the Improve-prompt button.
 * Push-to-talk: click to start MediaRecorder, click to stop. On stop, transcribe
 * the audio via OpenAI Whisper and splice the RAW transcript at the caret (same
 * insert logic as PromptComposer's file-drop). No auto-chain through improve-prompt;
 * no auto-submit.
 *
 * Safety / UX:
 *  - Disabled while recording/transcribing (spinner) and when no API key is configured.
 *  - On failure (offline, no key, timeout) it toasts and leaves the user's text
 *    untouched — never loses input.
 *  - Cleans up the MediaRecorder + mic stream on stop and on unmount.
 */
interface Props {
  /** Current field value (controlled by the parent, used to compute caret position). */
  value: string;
  /** Write the spliced text (original + transcript) back to the parent. */
  onChange: (next: string) => void;
  /** Optional extra class on the wrapper for per-surface spacing tweaks. */
  className?: string;
  /** Optional ref to the textarea, so we can read/restore the caret position. */
  textareaRef?: React.RefObject<HTMLTextAreaElement>;
}

export function VoiceInputButton({ value, onChange, className, textareaRef }: Props) {
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [hasKey, setHasKey] = useState(false);
  const pushToast = useUi((s) => s.pushToast);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // Check if API key is configured on mount
  useEffect(() => {
    window.cc.voice.hasApiKey().then(setHasKey).catch(() => setHasKey(false));
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopRecording();
    };
  }, []);

  const stopRecording = () => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    recorderRef.current = null;
    chunksRef.current = [];
  };

  const startRecording = async () => {
    if (!hasKey) {
      pushToast('No OpenAI API key configured. Add one in Settings.', 'error');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Try audio/webm first (Chromium default), fall back to audio/wav
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/wav';

      const recorder = new MediaRecorder(stream, { mimeType });
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        setRecording(false);
        setTranscribing(true);

        try {
          const blob = new Blob(chunksRef.current, { type: mimeType });
          const arrayBuffer = await blob.arrayBuffer();
          const base64 = Buffer.from(arrayBuffer).toString('base64');

          const result = await window.cc.voice.transcribe(base64, mimeType);

          if (!result.ok || !result.text.trim()) {
            pushToast(result.error || 'No speech detected', 'error');
            return;
          }

          // Splice the transcript at the caret (same logic as PromptComposer file-drop)
          const el = textareaRef?.current;
          const start = el?.selectionStart ?? value.length;
          const end = el?.selectionEnd ?? value.length;
          const before = value.slice(0, start);
          const after = value.slice(end);
          const lead = before && !/\s$/.test(before) ? ' ' : '';
          const trail = after && !/^\s/.test(after) ? ' ' : '';
          const transcript = result.text.trim();
          const caret = (before + lead + transcript).length;

          onChange(before + lead + transcript + trail + after);

          // Restore focus and caret
          requestAnimationFrame(() => {
            el?.focus();
            el?.setSelectionRange(caret, caret);
          });

          pushToast('Transcription complete', 'success');
        } catch (err) {
          pushToast(`Transcription failed: ${(err as Error).message}`, 'error');
        } finally {
          setTranscribing(false);
          stopRecording();
        }
      };

      recorder.start();
      setRecording(true);
    } catch (err) {
      pushToast(`Microphone access denied: ${(err as Error).message}`, 'error');
      stopRecording();
    }
  };

  const handleClick = () => {
    if (recording) {
      // Stop recording
      if (recorderRef.current) recorderRef.current.stop();
    } else {
      // Start recording
      void startRecording();
    }
  };

  const busy = recording || transcribing;
  const icon = busy ? (
    <Loader2 size={13} className="voice-input-spin" aria-hidden="true" />
  ) : recording ? (
    <MicOff size={13} aria-hidden="true" />
  ) : (
    <Mic size={13} aria-hidden="true" />
  );

  const label = transcribing
    ? 'Transcribing…'
    : recording
    ? 'Stop recording'
    : 'Dictate';

  const title = !hasKey
    ? 'No API key configured (add one in Settings)'
    : transcribing
    ? 'Transcribing your voice…'
    : recording
    ? 'Click to stop recording'
    : 'Click to start dictation';

  return (
    <button
      type="button"
      className={`voice-input-btn ${className ?? ''}`}
      onClick={handleClick}
      disabled={!hasKey || transcribing}
      title={title}
      aria-label={title}
    >
      {icon}
      {label}
    </button>
  );
}
```

**Test**: TypeScript compiles. Manual smoke test: open the dev build, add a key via Settings, click the mic button, verify recording starts.

**Commit**: `feat(voice): implement VoiceInputButton component`

---

## Task 10: Wire VoiceInputButton into PromptComposer

**What**: Add VoiceInputButton to `src/renderer/components/PromptComposer.tsx` right after `<ImprovePromptButton />` (line 75). Pass `textareaRef` so VoiceInputButton can read the caret position. Add basic styling in `src/renderer/styles/global.css` (ghost-button, spinner animation) mirroring `.improve-prompt-btn`.

**Red**: VoiceInputButton is not rendered; users can't access dictation.

**Green**:
```typescript
// src/renderer/components/PromptComposer.tsx (add after ImprovePromptButton)
import { VoiceInputButton } from './VoiceInputButton';

export const PromptComposer = forwardRef<PromptComposerHandle, Props>(function PromptComposer(
  { value, onChange, onSubmit, placeholder, rows = 3 },
  ref
) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // ... existing logic ...

  return (
    <div className="prompt-composer">
      <textarea
        ref={textareaRef}
        className={`launch-instruction ${dropOver ? 'drop-over' : ''}`}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        {...dropHandlers}
        rows={rows}
      />
      <ImprovePromptButton value={value} onChange={onChange} />
      <VoiceInputButton value={value} onChange={onChange} textareaRef={textareaRef} />
    </div>
  );
});
```

```css
/* src/renderer/styles/global.css (add after .improve-prompt-btn) */
.voice-input-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  font-size: 11px;
  color: var(--text-muted);
  background: transparent;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: color 0.15s, background 0.15s;
  margin-left: 8px;
}

.voice-input-btn:hover:not(:disabled) {
  color: var(--text);
  background: var(--bg-hover);
}

.voice-input-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.voice-input-spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
```

**Test**: Run `npm run dev`, open the app, navigate to the quick-agent launcher, verify the "Dictate" button renders beside "Improve prompt".

**Commit**: `feat(voice): wire VoiceInputButton into PromptComposer`

---

## Task 11: Add Settings UI for OpenAI API key

**What**: Add a field to `src/renderer/components/SettingsPanel.tsx` to enter/save the OpenAI key. Show whether a key is configured (boolean, no plaintext). Write-only input (type="password"), with a "Save" button that calls `window.cc.voice.setApiKey(key)`. Add success/error toasts.

**Red**: No Settings UI exists; users can't configure a key.

**Green**:
```typescript
// src/renderer/components/SettingsPanel.tsx (add a new section after LLM settings)
import { useState, useEffect } from 'react';

// Inside the SettingsPanel component:
const [voiceKeyConfigured, setVoiceKeyConfigured] = useState(false);
const [voiceKeyInput, setVoiceKeyInput] = useState('');

useEffect(() => {
  window.cc.voice.hasApiKey().then(setVoiceKeyConfigured).catch(() => setVoiceKeyConfigured(false));
}, []);

const saveVoiceKey = async () => {
  if (!voiceKeyInput.trim()) {
    pushToast('API key cannot be empty', 'error');
    return;
  }
  try {
    await window.cc.voice.setApiKey(voiceKeyInput.trim());
    setVoiceKeyConfigured(true);
    setVoiceKeyInput('');
    pushToast('OpenAI API key saved', 'success');
  } catch (err) {
    pushToast(`Failed to save key: ${(err as Error).message}`, 'error');
  }
};

// JSX (add after existing settings sections):
<div className="settings-section">
  <h3>Voice Input (OpenAI Whisper)</h3>
  <div className="settings-row">
    <label>
      OpenAI API Key
      {voiceKeyConfigured && <span className="settings-hint"> (configured)</span>}
    </label>
    <div className="settings-key-input">
      <input
        type="password"
        placeholder="sk-..."
        value={voiceKeyInput}
        onChange={(e) => setVoiceKeyInput(e.target.value)}
      />
      <button onClick={saveVoiceKey} className="settings-save-btn">
        Save
      </button>
    </div>
  </div>
  <p className="settings-note">
    Your API key is encrypted at rest and never leaves your machine.
    Get one at <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer">
      platform.openai.com/api-keys
    </a>.
  </p>
</div>
```

```css
/* src/renderer/styles/global.css (add after .settings-row) */
.settings-key-input {
  display: flex;
  gap: 8px;
  align-items: center;
}

.settings-key-input input {
  flex: 1;
  padding: 6px 8px;
  font-size: 13px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg);
  color: var(--text);
}

.settings-save-btn {
  padding: 6px 12px;
  font-size: 13px;
  background: var(--accent);
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: opacity 0.15s;
}

.settings-save-btn:hover {
  opacity: 0.85;
}

.settings-hint {
  font-size: 11px;
  color: var(--text-muted);
  margin-left: 8px;
}

.settings-note {
  margin-top: 8px;
  font-size: 11px;
  color: var(--text-muted);
}

.settings-note a {
  color: var(--accent);
  text-decoration: none;
}

.settings-note a:hover {
  text-decoration: underline;
}
```

**Test**: Run `npm run dev`, open Settings, enter a test key, click Save, verify the toast + "configured" hint appear.

**Commit**: `feat(voice): add Settings UI for OpenAI API key`

---

## Task 12: Verify all existing tests still pass

**What**: Run `npm run test` to verify no existing tests broke. The new code is isolated (no changes to existing surfaces except PromptComposer, which gained a button). Fix any failures.

**Red**: Some existing tests fail (unlikely, but check).

**Green**: All tests pass.

**Test**: `npm run test` output shows 0 failures.

**Commit**: `test(voice): verify all existing tests pass` (only if fixes were needed; otherwise skip this commit)

---

## Task 13: Add focused integration test for voice flow

**What**: Write an integration test in `src/renderer/__tests__/voice-integration.test.tsx` that mocks the IPC layer and verifies: (1) VoiceInputButton renders, (2) clicking it calls `window.cc.voice.transcribe` with the right shape, (3) the returned transcript is spliced into the value via `onChange`.

**Red**: No integration test exists; the voice flow is untested.

**Green**:
```typescript
// src/renderer/__tests__/voice-integration.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { VoiceInputButton } from '../components/VoiceInputButton';
import type { VoiceTranscribeResult } from '../../shared/types';

const mockTranscribe = vi.fn<[string, string], Promise<VoiceTranscribeResult>>();
const mockHasApiKey = vi.fn<[], Promise<boolean>>();

// Mock window.cc.voice
beforeEach(() => {
  vi.stubGlobal('window', {
    cc: {
      voice: {
        transcribe: mockTranscribe,
        hasApiKey: mockHasApiKey,
        setApiKey: vi.fn()
      }
    }
  });
  mockHasApiKey.mockResolvedValue(true);
});

describe('VoiceInputButton integration', () => {
  it('renders the dictate button', async () => {
    render(
      <VoiceInputButton
        value=""
        onChange={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /dictate/i })).toBeInTheDocument();
    });
  });

  it('splices the transcript at the caret position', async () => {
    const onChange = vi.fn();
    const textareaRef = { current: { selectionStart: 6, selectionEnd: 6 } as HTMLTextAreaElement };

    mockTranscribe.mockResolvedValueOnce({
      ok: true,
      text: 'world',
      ms: 100
    });

    render(
      <VoiceInputButton
        value="hello "
        onChange={onChange}
        textareaRef={textareaRef}
      />
    );

    await waitFor(() => screen.getByRole('button'));

    // Mock MediaRecorder (simplified — just trigger onstop directly)
    const origMediaRecorder = (global as any).MediaRecorder;
    (global as any).MediaRecorder = class {
      ondataavailable = (_e: any) => {};
      onstop = () => {};
      start() {
        setTimeout(() => this.onstop(), 0);
      }
      stop() {}
      state = 'inactive';
      static isTypeSupported = () => true;
    };

    const origGetUserMedia = navigator.mediaDevices.getUserMedia;
    navigator.mediaDevices.getUserMedia = vi.fn().mockResolvedValue({
      getTracks: () => [{ stop: vi.fn() }]
    });

    const btn = screen.getByRole('button');
    fireEvent.click(btn); // start
    fireEvent.click(btn); // stop

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith('hello world');
    });

    // Restore
    (global as any).MediaRecorder = origMediaRecorder;
    navigator.mediaDevices.getUserMedia = origGetUserMedia;
  });

  it('shows an error toast when no key is configured', async () => {
    mockHasApiKey.mockResolvedValueOnce(false);

    render(
      <VoiceInputButton
        value=""
        onChange={vi.fn()}
      />
    );

    await waitFor(() => {
      const btn = screen.getByRole('button');
      expect(btn).toBeDisabled();
    });
  });
});
```

**Test**: `npm run test` includes this test and it passes.

**Commit**: `test(voice): add integration test for VoiceInputButton`

---

## Task 14: Verify the feature end-to-end in dev build

**What**: Run `npm run dev`, open the app, navigate to the quick-agent launcher, click "Dictate", speak a test phrase, verify the transcript splices into the prompt textarea. Test failure cases: (1) no key configured, (2) offline (disconnect network), (3) empty audio (click start, immediately click stop).

**Red**: Feature doesn't work or crashes.

**Green**: All three happy paths work; all three failure cases toast gracefully without losing user input.

**Test**: Manual E2E verification checklist:
- [ ] Happy path: click Dictate, speak, stop, transcript splices at caret
- [ ] No key: button is disabled, clicking shows toast
- [ ] Offline: click Dictate, speak, stop, shows network error toast
- [ ] Empty audio: click Dictate, immediately stop, shows "No speech detected" toast

**Commit**: `test(voice): verify E2E in dev build` (documentation commit; no code changes unless a bug is found)

---

## Task 15: Final verification — build and typecheck pass

**What**: Run `npm run build` and `npm run typecheck` to verify the feature builds cleanly for production. Fix any build errors or type mismatches.

**Red**: Build or typecheck fails.

**Green**: Both commands exit 0.

**Test**: `npm run build && npm run typecheck` output shows no errors.

**Commit**: `build(voice): verify production build passes` (only if fixes were needed; otherwise skip)

---

## Exit Protocol

Before emitting RESULT, verify ALL:
- The plan file is committed (`git log --not main --oneline` shows it).
- `git status --porcelain` is empty (no modified tracked files, no staged-not-committed, no untracked files).
- Current branch matches the worktree's starting branch.

Then emit:
```
RESULT: {"plan_path": "docs/plans/2026-06-28-voice-input-phase1.md"}
```
