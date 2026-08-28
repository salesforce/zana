import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { RESERVED_ZCC_CLI_COMMANDS } from '@zana-ai/zcc-domain/thread-runtime';
import { GUIDE_CHAPTERS } from './guide-chapters.js';
import { runCli } from './run-cli.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const SKILL = readFileSync(
  join(ROOT, 'apps/server/src/plugins/builtin-skills/zcc-cli/SKILL.md'),
  'utf8'
);
const HELP_GROUPS = [
  'thread',
  'terminal',
  'machine',
  'project',
  'skill',
  'settings',
  'guide',
  'environment',
  'plugin',
  'marketplace',
  'status'
] as const;

describe('cli / guide / skill keep-in-sync', () => {
  it('reserves every product group name', () => {
    const reserved = new Set(RESERVED_ZCC_CLI_COMMANDS);
    for (const name of HELP_GROUPS) {
      expect(reserved, `"${name}" is missing from RESERVED_ZCC_CLI_COMMANDS`).toContain(name);
    }
  });

  it('--help mentions every product group', async () => {
    const help = await runCli(['node', 'zcc', '--help']);
    expect(help.exitCode).toBe(0);
    for (const name of HELP_GROUPS) {
      expect(help.stdout, `--help is missing ${name}`).toContain(name);
    }
  });

  it('zcc-cli skill documents the product groups and trust notes', () => {
    for (const name of HELP_GROUPS) {
      expect(SKILL, `zcc-cli skill is missing zcc ${name}`).toContain(`zcc ${name}`);
    }
    expect(SKILL).toContain('FORBIDDEN_AGENT');
    expect(SKILL).toContain('APP_NOT_RUNNING');
    expect(SKILL).toContain('--json');
    expect(SKILL).toContain('ZCC_SERVER_URL');
    expect(SKILL).toContain('zcc-plugin-authoring');
    expect(SKILL).toContain('plugin-commands');
  });

  it('guide chapters cover the documented set', () => {
    const ids = GUIDE_CHAPTERS.map((row) => row.id);
    expect(ids).toEqual([
      'overview',
      'threads',
      'projects',
      'machines',
      'terminals',
      'plugins',
      'automations',
      'agent-configuration',
      'environments'
    ]);
  });
});
