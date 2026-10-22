import { spawn } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** File capture also works across Electron's child-process stdout boundary. */
export async function runPluginSourceCommand(command: string, args: string[], cwd: string, options: {
  timeoutMs?: number; maxBytes?: number; env?: NodeJS.ProcessEnv; signal?: AbortSignal;
} = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  if (options.signal?.aborted) throw new Error('Plugin source command cancelled');
  const root = mkdtempSync(join(tmpdir(), 'zcc-plugin-source-'));
  const stdoutPath = join(root, 'stdout');
  const stderrPath = join(root, 'stderr');
  const stdoutFd = openSync(stdoutPath, 'wx', 0o600);
  const stderrFd = openSync(stderrPath, 'wx', 0o600);
  const maxBytes = options.maxBytes ?? 16 * 1024 * 1024;
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd, shell: false, detached: process.platform !== 'win32',
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', npm_config_update_notifier: 'false', ...options.env },
        stdio: ['ignore', stdoutFd, stderrFd]
      });
      let failure: Error | undefined;
      const kill = (error: Error) => {
        failure ??= error;
        try {
          if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
          else child.kill('SIGKILL');
        } catch { /* process already exited */ }
      };
      const onAbort = () => kill(new Error('Plugin source command cancelled'));
      options.signal?.addEventListener('abort', onAbort, { once: true });
      if (options.signal?.aborted) onAbort();
      const timeout = setTimeout(() => kill(new Error('Plugin source command timed out')), options.timeoutMs ?? 60_000);
      const cap = setInterval(() => {
        if (statSync(stdoutPath).size + statSync(stderrPath).size > maxBytes) {
          kill(new Error('Plugin source command output exceeds the size limit'));
        }
      }, 50);
      child.once('error', (error) => { failure ??= error; });
      child.once('close', (code) => {
        options.signal?.removeEventListener('abort', onAbort);
        clearTimeout(timeout);
        clearInterval(cap);
        if (failure) return reject(failure);
        if (statSync(stdoutPath).size + statSync(stderrPath).size > maxBytes) {
          return reject(new Error('Plugin source command output exceeds the size limit'));
        }
        resolve({ code: code ?? 1, stdout: readFileSync(stdoutPath, 'utf8'), stderr: readFileSync(stderrPath, 'utf8') });
      });
    });
  } finally {
    closeSync(stdoutFd);
    closeSync(stderrFd);
    rmSync(root, { recursive: true, force: true });
  }
}
