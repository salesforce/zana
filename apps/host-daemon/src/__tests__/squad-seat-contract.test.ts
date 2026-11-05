import { afterAll, describe, expect, it } from 'vitest';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  buildShimScript,
  foldPersonaIntoGuidance,
  parseDeniedEntries,
  planSeatContract
} from '../squad-seat-contract.js';

/**
 * Acceptance tests for the Squad seat contract helpers (#675), written before
 * the implementation. Shim tests run the generated script in a real `sh`.
 */

const root = mkdtempSync(join(tmpdir(), 'squad-seat-contract-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

interface ShimRun {
  status: number | null;
  stdout: string;
  stderr: string;
  marker: string;
}

/** Install a shim for `command` plus a fake real binary that records its argv and stdin. */
function runShim(
  command: string,
  prefixes: readonly (readonly string[])[],
  args: string[],
  opts: { stdin?: string; realExit?: number; installReal?: boolean; home?: string } = {}
): ShimRun {
  const dir = mkdtempSync(join(root, 'case-'));
  const shimDir = join(dir, 'shim');
  const realDir = join(dir, 'real');
  mkdirSync(shimDir);
  mkdirSync(realDir);
  const marker = join(dir, 'real-ran.txt');
  writeFileSync(join(shimDir, command), buildShimScript(command, prefixes), { mode: 0o700 });
  chmodSync(join(shimDir, command), 0o700);
  if (opts.installReal !== false) {
    writeFileSync(
      join(realDir, command),
      `#!/bin/sh\nprintf 'REAL-RAN' > '${marker}'\nfor a in "$@"; do printf 'arg=[%s]\\n' "$a"; done\ncat\nexit ${opts.realExit ?? 0}\n`,
      { mode: 0o700 }
    );
  }
  const result = spawnSync(join(shimDir, command), args, {
    input: opts.stdin ?? '',
    encoding: 'utf8',
    env: { PATH: `${shimDir}:${realDir}:/usr/bin:/bin`, HOME: opts.home ?? '/home/someone' }
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    marker: existsSync(marker) ? readFileSync(marker, 'utf8') : ''
  };
}

describe('parseDeniedEntries (REQ-3, REQ-9, REQ-12)', () => {
  it('returns nothing for undefined or empty lists', () => {
    expect(parseDeniedEntries(undefined)).toEqual({ shimmable: [], advisory: [] });
    expect(parseDeniedEntries([])).toEqual({ shimmable: [], advisory: [] });
  });

  it('splits Bash(command words:*) entries into command and prefix words', () => {
    const { shimmable, advisory } = parseDeniedEntries(['Bash(gh:*)', 'Bash(git push --force:*)']);
    expect(advisory).toEqual([]);
    expect(shimmable.map((e) => [e.command, e.prefix])).toEqual([
      ['gh', []],
      ['git', ['push', '--force']]
    ]);
    expect(shimmable[0]!.entry).toBe('Bash(gh:*)');
  });

  it('keeps Edit, Write, Read and mcp entries as advisory, never dropped (REQ-9)', () => {
    const entries = ['Edit(./src/**)', 'Write(/etc/hosts)', 'Read(~/.ssh/**)', 'mcp__zcc-inbox__inbox_push'];
    const { shimmable, advisory } = parseDeniedEntries(entries);
    expect(shimmable).toEqual([]);
    expect(advisory.map((a) => a.entry)).toEqual(entries);
    expect(advisory.every((a) => a.reason.length > 0)).toBe(true);
  });

  it('keeps path-prefixed and environment-prefixed Bash entries as advisory (REQ-9)', () => {
    const entries = ['Bash(/usr/bin/gh:*)', 'Bash(./scripts/deploy.sh:*)', 'Bash(FOO=bar gh:*)', 'Bash(env FOO=1 gh:*)'];
    const { shimmable, advisory } = parseDeniedEntries(entries);
    expect(shimmable).toEqual([]);
    expect(advisory.map((a) => a.entry)).toEqual(entries);
  });

  it('skips command names outside the safe pattern as advisory (REQ-12)', () => {
    const entries = ['Bash($(reboot):*)', 'Bash(a;b:*)', "Bash('x:*)", 'Bash(:*)'];
    const { shimmable, advisory } = parseDeniedEntries(entries);
    expect(shimmable).toEqual([]);
    expect(advisory).toHaveLength(entries.length);
  });

  it('accepts every character of the safe pattern in a command name', () => {
    const { shimmable } = parseDeniedEntries(['Bash(a.b_c+d-1:*)']);
    expect(shimmable.map((e) => e.command)).toEqual(['a.b_c+d-1']);
  });

  it('treats an entry without the :* suffix, or with unbalanced parentheses, as advisory', () => {
    const { shimmable, advisory } = parseDeniedEntries(['Bash(gh', 'Bash', '']);
    expect(shimmable).toEqual([]);
    expect(advisory.length).toBeGreaterThan(0);
  });
});

describe('buildShimScript (REQ-3, REQ-12)', () => {
  it('is a POSIX sh script', () => {
    expect(buildShimScript('gh', [[]]).startsWith('#!/bin/sh')).toBe(true);
  });

  it('refuses a matching call with exit 126 and the policy message, without running the real binary', () => {
    const run = runShim('gh', [['pr', 'create']], ['pr', 'create', '--title', 'x']);
    expect(run.status).toBe(126);
    expect(run.stderr + run.stdout).toContain('Refused by Squad policy');
    expect(run.marker).toBe('');
  });

  it('refuses every call when the prefix is empty', () => {
    const run = runShim('gh', [[]], ['--version']);
    expect(run.status).toBe(126);
    expect(run.marker).toBe('');
  });

  it('passes a non-matching call to the real binary with the same arguments, stdin and exit code', () => {
    const run = runShim('gh', [['pr', 'create']], ['pr', 'list', 'two words', "it's"], { stdin: 'piped-in', realExit: 7 });
    expect(run.status).toBe(7);
    expect(run.marker).toBe('REAL-RAN');
    expect(run.stdout).toContain('arg=[pr]');
    expect(run.stdout).toContain('arg=[list]');
    expect(run.stdout).toContain('arg=[two words]');
    expect(run.stdout).toContain("arg=[it's]");
    expect(run.stdout).toContain('piped-in');
  });

  it('matches the prefix word by word, not as a substring', () => {
    const run = runShim('git', [['push']], ['pushy']);
    expect(run.status).toBe(0);
    expect(run.marker).toBe('REAL-RAN');
  });

  it('refuses when any one of several prefixes matches', () => {
    const prefixes = [['push', '--force'], ['reset', '--hard']];
    expect(runShim('git', prefixes, ['reset', '--hard', 'HEAD~1']).status).toBe(126);
    expect(runShim('git', prefixes, ['push', '--force']).status).toBe(126);
    expect(runShim('git', prefixes, ['push']).status).toBe(0);
  });

  it('matches a "~" word as the home directory too', () => {
    const run = runShim('rm', [['-rf', '~/work']], ['-rf', '/home/someone/work'], { home: '/home/someone' });
    expect(run.status).toBe(126);
  });

  it('gives exit 127 when the real binary is missing, and does not call itself', () => {
    const run = runShim('gh', [['pr', 'create']], ['pr', 'list'], { installReal: false });
    expect(run.status).toBe(127);
    expect(run.marker).toBe('');
  });

  it('treats quotes and shell metacharacters in prefix words as data (REQ-12)', () => {
    const canary = join(root, 'injected.txt');
    const evil = [`'; touch ${canary}; '`, `$(touch ${canary})`, '`touch ' + canary + '`', '"\\"; touch ' + canary, '&& touch ' + canary];
    for (const word of evil) {
      const script = buildShimScript('gh', [[word]]);
      expect(() => spawnSync('sh', ['-n'], { input: script, encoding: 'utf8' })).not.toThrow();
      expect(spawnSync('sh', ['-n'], { input: script, encoding: 'utf8' }).status).toBe(0);
      const run = runShim('gh', [[word]], [word]);
      expect(run.status).toBe(126);
      const benign = runShim('gh', [[word]], ['status']);
      expect(benign.status).toBe(0);
      expect(existsSync(canary)).toBe(false);
    }
  });

  it('does not interpolate the command name into executable position of the refusal path', () => {
    const script = buildShimScript('gh', [[]]);
    expect(script).not.toMatch(/\$\(\s*gh\b/);
  });
});

describe('buildShimScript correctness obligations (CodeNod OBL-001, OBL-007)', () => {
  it('refuses a prefix of ten or more words (positional parameters past $9)', () => {
    const words = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
    const run = runShim('tool', [words], words);
    expect(run.status).toBe(126);
    expect(run.marker).toBe('');
    const other = runShim('tool', [words], [...words.slice(0, 9), 'z']);
    expect(other.status).toBe(0);
  });

  it('does not invoke itself when the shimmed command is one the shim itself needs (dirname)', () => {
    // A depth guard is injected after the shebang so a recursive shim stops at depth 3
    // instead of forking without limit.
    const dir = mkdtempSync(join(root, 'recur-'));
    const shimDir = join(dir, 'shim');
    const realDir = join(dir, 'real');
    mkdirSync(shimDir);
    mkdirSync(realDir);
    const script = buildShimScript('dirname', [['forbidden']]).replace(
      '#!/bin/sh\n',
      '#!/bin/sh\nZCC_DEPTH=$(( ${ZCC_DEPTH:-0} + 1 )); export ZCC_DEPTH\n[ "$ZCC_DEPTH" -gt 3 ] && { echo RECURSION-DETECTED; exit 99; }\n'
    );
    writeFileSync(join(shimDir, 'dirname'), script, { mode: 0o700 });
    const realDirname = spawnSync('sh', ['-c', 'command -v dirname'], { encoding: 'utf8' }).stdout.trim();
    writeFileSync(join(realDir, 'dirname'), `#!/bin/sh\nexec ${realDirname} "$@"\n`, { mode: 0o700 });
    const result = spawnSync(join(shimDir, 'dirname'), ['/tmp/example/file'], {
      encoding: 'utf8',
      timeout: 15_000,
      env: { PATH: `${shimDir}:${realDir}:/usr/bin:/bin` }
    });
    expect(result.stdout).not.toContain('RECURSION-DETECTED');
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('/tmp/example');
  });
});

describe('planSeatContract (REQ-2, REQ-3, REQ-9, REQ-12, REQ-13)', () => {
  it('returns an empty plan for a persona with neither instructions nor denylist (REQ-13)', () => {
    const plan = planSeatContract({ persona: {} });
    expect(plan.instructionsText).toBe('');
    expect(plan.shimFiles).toEqual([]);
    expect(plan.advisoryLines).toEqual([]);
  });

  it('carries the persona text in the instructions', () => {
    const plan = planSeatContract({ persona: { appendSystemPrompt: 'You are the reviewer.' } });
    expect(plan.instructionsText).toContain('You are the reviewer.');
    expect(plan.shimFiles).toEqual([]);
  });

  it('makes one shim per denied command, merging prefixes for the same command', () => {
    const plan = planSeatContract({ persona: { deniedTools: ['Bash(gh:*)', 'Bash(git push:*)', 'Bash(git reset --hard:*)'] } });
    expect(plan.shimFiles.map((f) => f.name).sort()).toEqual(['gh', 'git']);
    expect(plan.shimFiles.every((f) => f.script.startsWith('#!/bin/sh'))).toBe(true);
  });

  it('lists advisory entries in the instructions as not mechanically enforced (REQ-9)', () => {
    const plan = planSeatContract({
      persona: { appendSystemPrompt: 'Role text', deniedTools: ['Edit(./secrets/**)', 'mcp__x__y', 'Bash(/usr/bin/gh:*)', 'Bash(gh:*)'] }
    });
    expect(plan.advisoryLines).toHaveLength(3);
    expect(plan.instructionsText).toContain('Denied by Squad policy, not mechanically enforced on this harness');
    for (const entry of ['Edit(./secrets/**)', 'mcp__x__y', 'Bash(/usr/bin/gh:*)']) {
      expect(plan.instructionsText).toContain(entry);
    }
    expect(plan.instructionsText).toContain('Role text');
  });

  it('emits advisory text even when the persona has no appendSystemPrompt', () => {
    const plan = planSeatContract({ persona: { deniedTools: ['Read(~/.ssh/**)'] } });
    expect(plan.instructionsText).toContain('Read(~/.ssh/**)');
  });

  it('does not list allowedTools anywhere (D4)', () => {
    const plan = planSeatContract({ persona: { appendSystemPrompt: 'x', allowedTools: ['Bash(ls:*)'] } as never });
    expect(plan.instructionsText).not.toContain('Bash(ls:*)');
  });

  it('never shadows a reserved harness command; it becomes advisory instead (REQ-12)', () => {
    const plan = planSeatContract({ persona: { deniedTools: ['Bash(codex:*)', 'Bash(gh:*)'] }, reservedCommands: ['codex'] });
    expect(plan.shimFiles.map((f) => f.name)).toEqual(['gh']);
    expect(plan.advisoryLines.join('\n')).toContain('Bash(codex:*)');
  });

  it('skips unsafe command names as advisory and keeps injection strings out of file names (REQ-12)', () => {
    const plan = planSeatContract({ persona: { deniedTools: ['Bash(../evil:*)', 'Bash($(id):*)', 'Bash(gh:*)'] } });
    expect(plan.shimFiles.map((f) => f.name)).toEqual(['gh']);
    expect(plan.advisoryLines).toHaveLength(2);
  });
});

describe('foldPersonaIntoGuidance (REQ-1)', () => {
  it('appends the persona text after the product guidance', () => {
    const folded = foldPersonaIntoGuidance('PRODUCT GUIDANCE', { appendSystemPrompt: 'PERSONA TEXT' });
    expect(folded.indexOf('PRODUCT GUIDANCE')).toBeGreaterThanOrEqual(0);
    expect(folded.indexOf('PERSONA TEXT')).toBeGreaterThan(folded.indexOf('PRODUCT GUIDANCE'));
  });

  it('returns the guidance unchanged when the persona has no text', () => {
    expect(foldPersonaIntoGuidance('PRODUCT GUIDANCE', {})).toBe('PRODUCT GUIDANCE');
    expect(foldPersonaIntoGuidance('PRODUCT GUIDANCE', { appendSystemPrompt: '   ' })).toBe('PRODUCT GUIDANCE');
  });

  it('returns the persona text alone when the guidance is empty (injectProductGuidance off)', () => {
    expect(foldPersonaIntoGuidance('', { appendSystemPrompt: 'PERSONA TEXT' }).trim()).toBe('PERSONA TEXT');
  });
});
