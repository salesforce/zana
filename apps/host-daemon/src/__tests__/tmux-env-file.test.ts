import { execFileSync, spawnSync } from 'node:child_process';
import { dirname, basename } from 'node:path';
import { existsSync, readFileSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildLocalTmuxCommand } from '../tmux.js';
import { sessionEnvFilePath, writeSessionEnvFile } from '../tmux-session-env.js';

// Runs the REAL pane wrapper (everything after tmux's `--`) under sh, since the
// tmux-mocking suites never execute it.
function paneArgv(file: string, command: string, args: string[]): string[] {
  const { args: tmuxArgs } = buildLocalTmuxCommand('sess-envfile', command, args, {}, file);
  return tmuxArgs.slice(tmuxArgs.indexOf('--') + 1);
}

describe('tmux identity env file', () => {
  it('writes a 0600 file with quoted exports and skips undefined vars', () => {
    const path = writeSessionEnvFile('sess-envfile-w', { A: "it's", B: undefined, C: 'x y' });
    try {
      expect(path).toBe(sessionEnvFilePath('sess-envfile-w'));
      expect(statSync(path).mode & 0o777).toBe(0o600);
      const out = execFileSync('sh', ['-c', '. "$1"; printf "%s|%s|%s" "$A" "${B-unset}" "$C"', 'sh', path], {
        encoding: 'utf8'
      });
      expect(out).toBe("it's|unset|x y");
    } finally {
      execFileSync('rm', ['-f', path]);
    }
  });

  it('pane wrapper exports the vars, deletes the file, and execs the command with its args', () => {
    const path = writeSessionEnvFile('sess-envfile', { ZCC_SESSION_TOKEN: 'tok$en"`x' });
    const [cmd, ...rest] = paneArgv(path, 'sh', ['-c', 'printf "%s %s" "$ZCC_SESSION_TOKEN" "$1"', 'sh', 'arg one']);
    const res = spawnSync(cmd, rest, { encoding: 'utf8' });
    expect(res.status).toBe(0);
    expect(res.stdout).toBe('tok$en"`x arg one');
    expect(existsSync(path)).toBe(false);
  });

  it('pane wrapper fails closed and never runs the command when the file is missing', () => {
    const [cmd, ...rest] = paneArgv('/nonexistent/zcc-env-file', 'sh', ['-c', 'echo RAN']);
    const res = spawnSync(cmd, rest, { encoding: 'utf8' });
    expect(res.status).not.toBe(0);
    expect(res.stdout).not.toContain('RAN');
  });

  it('unsets undefined vars so the pane drops the tmux server snapshot value', () => {
    const path = writeSessionEnvFile('sess-envfile-u', { KEEP: 'a', DROP: undefined });
    try {
      expect(readFileSync(path, 'utf8')).toBe("export KEEP='a'\nunset DROP\n");
      const out = execFileSync('sh', ['-c', '. "$1"; printf "%s|%s" "$KEEP" "${DROP-unset}"', 'sh', path], {
        encoding: 'utf8',
        env: { ...process.env, DROP: 'stale-from-tmux-server' }
      });
      expect(out).toBe('a|unset');
    } finally {
      unlinkSync(path);
    }
  });

  it('uses a unique caller-owned 0700 directory, not a predictable shared path', () => {
    const path = sessionEnvFilePath('sess-envfile-d');
    const dir = dirname(path);
    writeSessionEnvFile('sess-envfile-d', { A: '1' });
    try {
      expect(basename(dir)).toMatch(/^zcc-session-env-.+/);
      expect(statSync(dir).mode & 0o777).toBe(0o700);
      expect(statSync(dir).uid).toBe(process.getuid?.() ?? statSync(dir).uid);
    } finally {
      unlinkSync(path);
    }
  });

  it('replaces a stale file and refuses to follow a planted symlink', () => {
    const path = sessionEnvFilePath('sess-envfile-s');
    writeFileSync(path, 'stale');
    writeSessionEnvFile('sess-envfile-s', { A: '1' });
    expect(readFileSync(path, 'utf8')).toBe("export A='1'\n");
    unlinkSync(path);
    const victim = `${path}.victim`;
    writeFileSync(victim, 'victim');
    symlinkSync(victim, path);
    try {
      writeSessionEnvFile('sess-envfile-s', { A: '1' });
      // symlink was unlinked, not followed
      expect(readFileSync(victim, 'utf8')).toBe('victim');
    } finally {
      unlinkSync(path);
      unlinkSync(victim);
    }
  });

  it('leaves the command untouched when no env file is supplied', () => {
    const { args } = buildLocalTmuxCommand('sess-1', 'claude', ['--x']);
    expect(args.slice(args.indexOf('--') + 1)).toEqual(['claude', '--x']);
  });
});
