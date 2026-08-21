import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PromptRegistry } from './prompt-registry.js';
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
});
