import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PromptRegistry } from './prompt-registry.js';
import { fillTemplate } from './llm-service.js';
import { redactTranscript } from './redact-transcript.js';
import type { LlmPromptEntry } from '@zana-ai/zcc-domain/llm';

describe('PromptRegistry', () => {
  let registry: PromptRegistry;
  const testHome = join(tmpdir(), `prompt-registry-test-${Date.now()}`);
  const userDir = join(testHome, '.zcc', 'llm-prompts');
  const revealPath = vi.fn(async () => undefined);

  beforeEach(() => {
    if (existsSync(testHome)) rmSync(testHome, { recursive: true, force: true });
    mkdirSync(testHome, { recursive: true });
    revealPath.mockReset();
    registry = new PromptRegistry({ homeDir: testHome, revealPath });
    registry.start();
  });

  afterEach(() => {
    registry.stop();
    if (existsSync(testHome)) rmSync(testHome, { recursive: true, force: true });
  });

  it('ships the built-in tab-namer', () => {
    const tabNamer = registry.get('builtin:tab-namer');
    expect(tabNamer).not.toBeNull();
    expect(tabNamer?.source).toBe('builtin');
    expect(tabNamer?.userTemplate).toContain('{{prompt}}');
    expect(tabNamer?.description).toMatch(/thread/i);
  });

  it('ships the built-in turn-summary (haiku, last-turn input)', () => {
    const entry = registry.get('builtin:turn-summary');
    expect(entry).not.toBeNull();
    expect(entry?.source).toBe('builtin');
    expect(entry?.provider).toBe('claude-cli');
    expect(entry?.model).toBe('haiku');
    expect(entry?.userTemplate).toContain('{{lastTurn}}');
    expect(entry?.maxOutputChars).toBe(600);
    expect(entry?.timeoutMs).toBe(30_000);
  });

  it('ships idle-triage and catch-up-summary on claude-cli', () => {
    for (const id of ['builtin:idle-triage', 'builtin:catch-up-summary']) {
      const entry = registry.get(id);
      expect(entry?.source).toBe('builtin');
      expect(entry?.provider).toBe('claude-cli');
    }
  });

  it('registers builtin:approve-reviewer', () => {
    const entry = registry.get('builtin:approve-reviewer');
    expect(entry).not.toBeNull();
    expect(entry?.source).toBe('builtin');
    expect(entry?.provider).toBe('claude-cli');
    expect(entry?.model).toBe('haiku');
    expect(entry?.userTemplate).toContain('{{summary}}');
  });

  it('ships the built-in improve-prompt (drives the Improve prompt button)', () => {
    const improve = registry.get('builtin:improve-prompt');
    expect(improve).not.toBeNull();
    expect(improve?.source).toBe('builtin');
    // The button passes the field text as {{prompt}}; the template must consume it.
    expect(improve?.userTemplate).toContain('{{prompt}}');
  });

  it('saveUser shadows a built-in by id', () => {
    const base = registry.get('builtin:tab-namer')!;
    registry.saveUser({ ...base, label: 'My Namer', model: 'sonnet' });

    const shadowed = registry.get('builtin:tab-namer');
    expect(shadowed?.source).toBe('user');
    expect(shadowed?.label).toBe('My Namer');
    expect(shadowed?.model).toBe('sonnet');
    // Still exactly one entry for that id (shadow, not duplicate).
    expect(registry.list().filter((p) => p.id === 'builtin:tab-namer')).toHaveLength(1);
  });

  it('deleteUser un-shadows a built-in back to the shipped default', () => {
    const base = registry.get('builtin:tab-namer')!;
    registry.saveUser({ ...base, label: 'My Namer' });
    expect(registry.get('builtin:tab-namer')?.source).toBe('user');

    registry.deleteUser('builtin:tab-namer');
    const reset = registry.get('builtin:tab-namer');
    expect(reset?.source).toBe('builtin');
    expect(reset?.label).toBe(base.label);
  });

  it('loads a purely-user prompt from disk and skips invalid files', () => {
    mkdirSync(userDir, { recursive: true });
    const valid: LlmPromptEntry = {
      id: 'summarize',
      label: 'Summarize',
      systemPrompt: 'Summarize the text.',
      userTemplate: '{{text}}'
    };
    writeFileSync(join(userDir, 'summarize.json'), JSON.stringify(valid));
    // Missing required fields — must be skipped.
    writeFileSync(join(userDir, 'broken.json'), JSON.stringify({ id: 'broken' }));

    registry.refresh();
    expect(registry.get('summarize')?.label).toBe('Summarize');
    expect(registry.get('broken')).toBeNull();
  });

  it('writes a filesystem-safe filename for an id with separators', () => {
    const base = registry.get('builtin:tab-namer')!;
    registry.saveUser(base);
    const files = readdirSync(userDir).filter((f) => f.endsWith('.json'));
    expect(files).toContain('builtin_tab-namer.json');
  });

  // A.2: config-WRITE-time model validation. saveUser rejects an unusable
  // model at the write boundary (thrown Error → rejected IPC invoke → UI
  // error), rather than accepting it and silently dropping it on next read.
  it('saveUser throws on an unusable (empty/whitespace) model', () => {
    const base = registry.get('builtin:tab-namer')!;
    expect(() => registry.saveUser({ ...base, id: 'bad-empty', model: '' })).toThrow(/invalid model/i);
    expect(() => registry.saveUser({ ...base, id: 'bad-ws', model: '   ' })).toThrow(/invalid model/i);
    // The rejected write never lands on disk.
    expect(registry.get('bad-empty')).toBeNull();
    expect(registry.get('bad-ws')).toBeNull();
  });

  it('saveUser accepts a Claude tier alias, a provider-native id, and no model', () => {
    const base = registry.get('builtin:tab-namer')!;
    // Claude tier alias.
    expect(() => registry.saveUser({ ...base, id: 'ok-alias', model: 'sonnet' })).not.toThrow();
    expect(registry.get('ok-alias')?.model).toBe('sonnet');
    // Provider-native id.
    expect(() =>
      registry.saveUser({ ...base, id: 'ok-native', provider: 'openai', model: 'gpt-4o' })
    ).not.toThrow();
    expect(registry.get('ok-native')?.model).toBe('gpt-4o');
    // No model → provider default applies.
    expect(() =>
      registry.saveUser({ ...base, id: 'ok-nomodel', model: undefined })
    ).not.toThrow();
    expect(registry.get('ok-nomodel')?.model).toBeUndefined();
  });

  it("saveUser throws on a typo'd alias for a tier-map provider", () => {
    const base = registry.get('builtin:tab-namer')!;
    expect(() =>
      registry.saveUser({ ...base, id: 'bad-typo', provider: 'openai', model: 'haiky' })
    ).toThrow(/invalid model/i);
    // The rejected write never lands on disk.
    expect(registry.get('bad-typo')).toBeNull();
  });

  it('saveUser throws on a plausible-looking but shape-invalid model (internal space)', () => {
    const base = registry.get('builtin:tab-namer')!;
    // "gpt 4o" reads like a real id but the internal space makes it garbage.
    expect(() =>
      registry.saveUser({ ...base, id: 'bad-space', provider: 'openai', model: 'gpt 4o' })
    ).toThrow(/invalid model/i);
    // The rejected write never lands on disk.
    expect(registry.get('bad-space')).toBeNull();
  });

  // Regression (QA medium #12): saveUser used a bare writeFileSync, so a crash
  // mid-write left a truncated JSON that failed the next JSON.parse and silently
  // dropped the prompt. It now writes via tmp+rename (Rule 4). Assert the final
  // file is complete, valid JSON and no tmp sibling leaks.
  it('saveUser writes atomically (valid JSON, no tmp leftover)', () => {
    const base = registry.get('builtin:tab-namer')!;
    registry.saveUser({ ...base, id: 'atomic-test', label: 'Atomic', systemPrompt: 'x'.repeat(5000) });

    const files = readdirSync(userDir);
    // The final file exists and is fully parseable (not truncated).
    const target = files.find((f) => f === 'atomic-test.json');
    expect(target).toBeDefined();
    const parsed = JSON.parse(readFileSync(join(userDir, target!), 'utf8'));
    expect(parsed.label).toBe('Atomic');
    expect(parsed.systemPrompt).toHaveLength(5000);
    // No `.tmp-` sibling left dangling after the rename.
    expect(files.filter((f) => f.includes('.tmp-'))).toEqual([]);
  });

  it('revealUserDir uses the injected path opener, not Electron', async () => {
    const result = await registry.revealUserDir();
    expect(result.ok).toBe(true);
    expect(result.path).toBe(userDir);
    expect(revealPath).toHaveBeenCalledWith(userDir);
  });

  // SECURITY: idle-triage and catch-up-summary run on `claude-cli` (a coding
  // harness) and feed it RAW agent-transcript prose. The dispatch site
  // (`host.ts`) redacts transcript vars with `redactTranscript` before they are
  // interpolated into the prompt, so a credential the observed agent printed can
  // never reach the harness verbatim. Prove the BUILT prompt string (template +
  // redacted var, exactly as `LlmService.run` assembles it) omits the raw secret.
  describe('monitor-prompt transcript redaction', () => {
    const SECRETS = [
      'Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345',
      'api_key=super-secret-value-1234',
      'https://x.invalid/cb?token=abc123456789def',
      'AKIA1234567890ABCDEF',
      'ghp_abcdefghijklmnopqrstuvwxyz123456',
      'password: hunter2-should-never-leak'
    ];
    const rawSubstrings = [
      'abcdefghijklmnopqrstuvwxyz012345',
      'super-secret-value-1234',
      'abc123456789def',
      'AKIA1234567890ABCDEF',
      'ghp_abcdefghijklmnopqrstuvwxyz123456',
      'hunter2-should-never-leak'
    ];

    it('idle-triage built prompt drops raw transcript secrets', () => {
      const entry = registry.get('builtin:idle-triage')!;
      const transcript = `The agent ran: ${SECRETS.join(' and ')}`;
      // Mirrors host.ts: redact the transcript var, then fill the template.
      const built = fillTemplate(entry.userTemplate, { lastTurn: redactTranscript(transcript) });
      for (const raw of rawSubstrings) expect(built).not.toContain(raw);
      expect(built).toContain('[redacted]');
    });

    it('catch-up-summary built prompt drops raw transcript secrets', () => {
      const entry = registry.get('builtin:catch-up-summary')!;
      const digest = `Assistant said: ${SECRETS.join('; ')}`;
      const built = fillTemplate(entry.userTemplate, {
        digest: redactTranscript(digest),
        trigger: 'idle'
      });
      for (const raw of rawSubstrings) expect(built).not.toContain(raw);
      expect(built).toContain('[redacted]');
    });

    it('redacts a PEM private key block and secret-bearing URL values', () => {
      const pem =
        '-----BEGIN RSA PRIVATE KEY-----\nMIIEmostdefinitelysecret\n-----END RSA PRIVATE KEY-----';
      expect(redactTranscript(pem)).not.toContain('MIIEmostdefinitelysecret');
      const url = redactTranscript('see https://h.invalid/x?token=deadbeefcafe1234');
      expect(url).not.toContain('deadbeefcafe1234');
      expect(url).toContain('[redacted]');
    });

    it('leaves secret-free prose untouched', () => {
      const clean = 'Refactored the login redirect and added two unit tests.';
      expect(redactTranscript(clean)).toBe(clean);
    });
  });
});
