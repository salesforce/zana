import { spawn } from 'node:child_process';
import { dirname } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { WorkspaceError } from './error.js';
import { gitChildEnv } from './git-env.js';

const CLONE_TIMEOUT_MS = 20 * 60 * 1000;
const DIAGNOSTIC_CHARS = 16_384;
const PROGRESS_CHARS = 4096;

/** Git can echo URL credentials in both progress and errors. */
function redactCredentials(text: string): string {
  return text.replace(/(https?:\/\/)[^\s/]+@/gi, '$1[redacted]@');
}

/** Keep the existing streaming capture, retaining a bounded stderr tail on failure. */
export function runGitClone(remoteUrl: string, targetPath: string, onProgress?: (line: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['clone', '--progress', '--', remoteUrl, targetPath], {
      cwd: dirname(targetPath),
      env: { ...gitChildEnv(), GIT_TERMINAL_PROMPT: '0' },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stderrTail = '';
    let settled = false;
    const streams = [child.stdout, child.stderr].map((stream, index) => {
      const decoder = new StringDecoder('utf8');
      let leftover = '';
      const consume = (text: string) => {
        if (settled) return;
        if (index === 1) stderrTail = redactCredentials(stderrTail + text).slice(-DIAGNOSTIC_CHARS);
        const parts = (leftover + text).split(/\r|\n/);
        leftover = redactCredentials(parts.pop() ?? '').slice(-PROGRESS_CHARS);
        for (const line of parts) {
          const trimmed = line.trim();
          if (trimmed) onProgress?.(redactCredentials(trimmed).slice(-PROGRESS_CHARS));
        }
      };
      stream.on('data', (buf: Buffer) => consume(decoder.write(buf)));
      return () => {
        consume(decoder.end());
        if (leftover.trim()) onProgress?.(redactCredentials(leftover.trim()));
      };
    });
    const finish = (error?: WorkspaceError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(() => {
      finish(new WorkspaceError('git_failed', 'git clone timed out'));
      child.kill('SIGKILL');
    }, CLONE_TIMEOUT_MS);
    child.on('error', (error: Error) => finish(new WorkspaceError('git_failed', error.message)));
    child.on('close', (code) => {
      if (settled) return;
      streams.forEach(flush => flush());
      finish(code === 0 ? undefined : new WorkspaceError('git_failed',
        redactCredentials(stderrTail.trim()) || `git clone exited ${code ?? 'null'}`));
    });
  });
}
