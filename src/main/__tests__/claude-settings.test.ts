import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readClaudeProjectSettings,
  writeClaudeProjectSettings
} from '../claude-settings.js';

describe('claude-settings', () => {
  let project: string;

  beforeEach(async () => {
    project = await mkdtemp(join(tmpdir(), 'claude-settings-'));
  });

  afterEach(async () => {
    await rm(project, { recursive: true, force: true });
  });

  it('returns an empty view when the file is missing', async () => {
    const r = await readClaudeProjectSettings(project, 'shared');
    expect(r.exists).toBe(false);
    expect(r.settings).toEqual({});
    expect(r.path.endsWith('.claude/settings.json')).toBe(true);
  });

  it('parses known fields and stashes unknown ones', async () => {
    await mkdir(join(project, '.claude'), { recursive: true });
    await writeFile(
      join(project, '.claude', 'settings.local.json'),
      JSON.stringify({
        permissions: {
          allow: ['Bash(git:*)'],
          deny: ['Bash(rm:*)'],
          defaultMode: 'plan',
          additionalDirectories: ['/x'],
          // Unknown permission key — must round-trip.
          futureFlag: true
        },
        model: 'opus',
        // Unknown top-level key — must round-trip.
        env: { FOO: 'bar' }
      })
    );

    const r = await readClaudeProjectSettings(project, 'local');
    expect(r.exists).toBe(true);
    expect(r.settings.permissions?.allow).toEqual(['Bash(git:*)']);
    expect(r.settings.permissions?.deny).toEqual(['Bash(rm:*)']);
    expect(r.settings.permissions?.defaultMode).toBe('plan');
    expect(r.settings.permissions?.additionalDirectories).toEqual(['/x']);
    expect(r.settings.model).toBe('opus');
    expect(r.settings._unknown).toEqual({ env: { FOO: 'bar' } });
    expect(r.settings._unknownPermissions).toEqual({ futureFlag: true });
  });

  it('preserves unknown keys verbatim on write', async () => {
    await mkdir(join(project, '.claude'), { recursive: true });
    const initial = {
      permissions: {
        allow: ['Bash(git:*)'],
        defaultMode: 'plan' as const,
        futureFlag: true
      },
      env: { FOO: 'bar' },
      hooks: { preCommit: 'echo hi' }
    };
    const file = join(project, '.claude', 'settings.json');
    await writeFile(file, JSON.stringify(initial));

    // Patch only `allow`. env, hooks, and permissions.futureFlag must survive.
    await writeClaudeProjectSettings(project, 'shared', {
      permissions: { allow: ['Edit', 'Read'] }
    });

    const text = await readFile(file, 'utf-8');
    const parsed = JSON.parse(text);
    expect(parsed.env).toEqual({ FOO: 'bar' });
    expect(parsed.hooks).toEqual({ preCommit: 'echo hi' });
    expect(parsed.permissions.allow).toEqual(['Edit', 'Read']);
    expect(parsed.permissions.defaultMode).toBe('plan');
    expect(parsed.permissions.futureFlag).toBe(true);
  });

  it('drops empty arrays so the JSON stays tidy', async () => {
    await writeClaudeProjectSettings(project, 'local', {
      permissions: { allow: ['Edit'], deny: [] }
    });
    const text = await readFile(
      join(project, '.claude', 'settings.local.json'),
      'utf-8'
    );
    const parsed = JSON.parse(text);
    expect(parsed.permissions.allow).toEqual(['Edit']);
    expect('deny' in parsed.permissions).toBe(false);
  });

  it('creates the .claude directory on first write', async () => {
    await writeClaudeProjectSettings(project, 'shared', { model: 'haiku' });
    const text = await readFile(join(project, '.claude', 'settings.json'), 'utf-8');
    expect(JSON.parse(text)).toEqual({ model: 'haiku' });
  });
});
