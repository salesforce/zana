import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Inject ZCC_CLAUDE_HOME before importing the module under test, so the lazy
// getSettingsFile() resolver writes into the temp home (same idiom as plugins.test.ts).
let fakeHome: string;

async function freshImport() {
  return import('./authorizations.js');
}

function settingsPath(): string {
  return join(fakeHome, '.claude', 'settings.json');
}

async function readSettings(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(settingsPath(), 'utf-8'));
}

describe('applyAuthorizations (claude)', () => {
  beforeEach(async () => {
    fakeHome = await mkdtemp(join(tmpdir(), 'cc-authz-test-'));
    process.env.ZCC_CLAUDE_HOME = fakeHome;
    await mkdir(join(fakeHome, '.claude'), { recursive: true });
  });

  afterEach(async () => {
    delete process.env.ZCC_CLAUDE_HOME;
    await rm(fakeHome, { recursive: true, force: true });
  });

  it('writes a read-only allow list and default mode when no file exists', async () => {
    const { applyAuthorizations } = await freshImport();
    const results = await applyAuthorizations({ providers: ['claude'], tier: 'read-only' });

    expect(results).toHaveLength(1);
    expect(results[0].ok).toBe(true);
    const s = (await readSettings()).permissions as Record<string, unknown>;
    expect(s.defaultMode).toBe('default');
    expect(s.allow).toContain('Read');
    expect(s.allow).toContain('Bash(git status:*)');
    // read-only must NOT grant Edit/Write.
    expect(s.allow).not.toContain('Edit');
    expect(s.allow).not.toContain('Write');
  });

  it('standard tier is a superset that adds edits + dev commands', async () => {
    const { applyAuthorizations } = await freshImport();
    await applyAuthorizations({ providers: ['claude'], tier: 'standard' });
    const s = (await readSettings()).permissions as Record<string, unknown>;
    expect(s.allow).toContain('Read'); // still has read-only rules
    expect(s.allow).toContain('Edit');
    expect(s.allow).toContain('Bash(npm test:*)');
  });

  it('trusted tier sets bypassPermissions and adds no allow rules', async () => {
    const { applyAuthorizations } = await freshImport();
    await applyAuthorizations({ providers: ['claude'], tier: 'trusted' });
    const s = (await readSettings()).permissions as Record<string, unknown>;
    expect(s.defaultMode).toBe('bypassPermissions');
    expect(s.allow).toBeUndefined();
  });

  it('preserves unrelated keys and merges (dedupes) the user\'s existing allow rules', async () => {
    await writeFile(
      settingsPath(),
      JSON.stringify({
        model: 'sonnet',
        env: { FOO: 'bar' },
        permissions: { allow: ['Read', 'Bash(custom:*)'], deny: ['Bash(rm:*)'] }
      })
    );
    const { applyAuthorizations } = await freshImport();
    await applyAuthorizations({ providers: ['claude'], tier: 'read-only' });

    const raw = await readSettings();
    // Untouched top-level keys survive.
    expect(raw.model).toBe('sonnet');
    expect(raw.env).toEqual({ FOO: 'bar' });
    const perms = raw.permissions as Record<string, unknown>;
    // The user's own deny survives; their custom allow survives; 'Read' isn't duplicated.
    expect(perms.deny).toEqual(['Bash(rm:*)']);
    expect(perms.allow).toContain('Bash(custom:*)');
    expect((perms.allow as string[]).filter((r) => r === 'Read')).toHaveLength(1);
  });

  it('reports pi as not-yet-implemented without throwing', async () => {
    const { applyAuthorizations } = await freshImport();
    const results = await applyAuthorizations({ providers: ['pi'], tier: 'standard' });
    expect(results.map((r) => r.provider)).toEqual(['pi']);
    expect(results.every((r) => r.ok === false)).toBe(true);
    // Claude settings file must not have been created by a pi apply.
    await expect(readFile(settingsPath(), 'utf-8')).rejects.toBeDefined();
  });
});

describe('applyAuthorizations (codex)', () => {
  let codexHome: string;

  function codexConfigPath(): string {
    return join(codexHome, 'config.toml');
  }

  beforeEach(async () => {
    codexHome = await mkdtemp(join(tmpdir(), 'cc-authz-codex-'));
    process.env.CODEX_HOME = codexHome;
  });

  afterEach(async () => {
    delete process.env.CODEX_HOME;
    await rm(codexHome, { recursive: true, force: true });
  });

  it('writes approval_policy + sandbox_mode per tier (no file yet)', async () => {
    const { applyAuthorizations } = await freshImport();
    const results = await applyAuthorizations({ providers: ['codex'], tier: 'read-only' });
    expect(results).toHaveLength(1);
    expect(results[0].ok).toBe(true);
    const raw = await readFile(codexConfigPath(), 'utf-8');
    expect(raw).toContain('approval_policy = "untrusted"');
    expect(raw).toContain('sandbox_mode = "read-only"');
  });

  it('maps standard + trusted tiers to the codex value sets', async () => {
    const { applyAuthorizations } = await freshImport();
    await applyAuthorizations({ providers: ['codex'], tier: 'standard' });
    let raw = await readFile(codexConfigPath(), 'utf-8');
    expect(raw).toContain('approval_policy = "on-request"');
    expect(raw).toContain('sandbox_mode = "workspace-write"');

    await applyAuthorizations({ providers: ['codex'], tier: 'trusted' });
    raw = await readFile(codexConfigPath(), 'utf-8');
    expect(raw).toContain('approval_policy = "never"');
    expect(raw).toContain('sandbox_mode = "danger-full-access"');
  });

  it('preserves unrelated keys already in config.toml', async () => {
    const { parse: parseToml } = await import('smol-toml');
    await writeFile(codexConfigPath(), 'model = "o3"\napproval_policy = "on-request"\n');
    const { applyAuthorizations } = await freshImport();
    await applyAuthorizations({ providers: ['codex'], tier: 'trusted' });
    const parsed = parseToml(await readFile(codexConfigPath(), 'utf-8')) as Record<string, unknown>;
    // Unrelated key survives; our two keys are updated.
    expect(parsed.model).toBe('o3');
    expect(parsed.approval_policy).toBe('never');
    expect(parsed.sandbox_mode).toBe('danger-full-access');
  });
});
