import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
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

  it('leaves the command untouched when no env file is supplied', () => {
    const { args } = buildLocalTmuxCommand('sess-1', 'claude', ['--x']);
    expect(args.slice(args.indexOf('--') + 1)).toEqual(['claude', '--x']);
  });
});
