import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { appendFile, chmod, mkdir, rename, stat } from 'node:fs/promises';
import { join } from 'node:path';

export function redactRuntimeLog(value: string, env: NodeJS.ProcessEnv = process.env): string {
  let result = value;
  for (const [key, secret] of Object.entries(env)) {
    if (secret && secret.length >= 8 && /token|secret|password|credential|api.?key/i.test(key)) result = result.split(secret).join('[redacted]');
  }
  return result
    .replace(/(--(?:join-code|host-key|token|password|api-key)\s+)(?:"[^"]*"|'[^']*'|\S+)/gi, '$1[redacted]')
    .replace(/(Bearer\s+)[^\s"',;]+/gi, '$1[redacted]')
    .replace(/((?:token|key|password|secret|credential|join-code|host-key)["']?\s*[:=]\s*["']?)[^\s"'&,}]+/gi, '$1[redacted]')
    .replace(/(https?:\/\/)[^/\s:@]+:[^/\s@]+@/gi, '$1[redacted]@')
    .replace(/\/t\/zcrs_[A-Za-z0-9_-]+/g, '/t/[redacted]');
}

/** Serialized, bounded disk sink. Logging failure must never bring down the runtime. */
export function createRuntimeLog(dataDir: string, role: string, options: { maxBytes?: number; env?: NodeJS.ProcessEnv } = {}) {
  if (!/^[a-z-]+$/.test(role)) throw new Error('Invalid runtime log role');
  const dir = join(dataDir, 'logs'), file = join(dir, `${role}.log`);
  const limit = options.maxBytes ?? 2 * 1024 * 1024;
  let queued = 0, dropped = 0;
  let tail: Promise<void> = Promise.resolve();
  function write(level: string, args: unknown[]): void {
    if (queued >= 64) { dropped++; return; }
    // Avoid inspecting arbitrary object graphs, getters, request bodies or prompts.
    const text = args.slice(0, 10).map(arg => arg instanceof Error ? arg.stack ?? arg.message
      : typeof arg === 'string' ? arg : arg === null ? 'null'
      : typeof arg === 'object' ? '[object]' : String(arg)).join(' ');
    const line = `${new Date().toISOString()} ${process.pid} ${level} ${redactRuntimeLog(text, options.env).slice(0, 8192)}${dropped ? ` [dropped ${dropped} messages]` : ''}\n`;
    dropped = 0; queued++;
    tail = tail.then(async () => {
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const size = await stat(file).then(s => s.size, () => 0);
      if (size + Buffer.byteLength(line) > limit) {
        await rename(`${file}.1`, `${file}.2`).catch(() => {});
        await rename(file, `${file}.1`).catch(() => {});
      }
      await appendFile(file, line, { mode: 0o600 });
      await chmod(file, 0o600);
    }).catch(() => {}).finally(() => { queued--; });
  }
  return { file, write, flush: () => tail };
}

/** A dev launcher may exit first. Never report its broken pipe through that same pipe. */
export function guardOutputPipes(streams: readonly {
  on(event: 'error', listener: (error: NodeJS.ErrnoException) => void): unknown;
  off(event: 'error', listener: (error: NodeJS.ErrnoException) => void): unknown;
}[] = [process.stdout, process.stderr]) {
  const onError = (error: NodeJS.ErrnoException) => {
    if (error.code !== 'EPIPE') throw error;
  };
  for (const stream of streams) stream.on('error', onError);
  return () => { for (const stream of streams) stream.off('error', onError); };
}

/** Install once at each executable's entry; console output remains available to dev/test runners. */
export function installRuntimeLog(dataDir: string, role: string, bundle?: string | URL) {
  const sink = createRuntimeLog(dataDir, role);
  const releaseOutputPipes = guardOutputPipes();
  const originals = { warn: console.warn, error: console.error };
  const wrappers = {
    warn: (...args: unknown[]) => { sink.write('warn', args); originals.warn(...args); },
    error: (...args: unknown[]) => { sink.write('error', args); originals.error(...args); }
  };
  console.warn = wrappers.warn; console.error = wrappers.error;
  const fatal = (error: Error) => sink.write('fatal', [error]);
  process.on('uncaughtExceptionMonitor', fatal);
  sink.write('startup', [`role=${role} node=${process.versions.node} electron=${process.versions.electron ?? '-'} executable=${process.execPath}`]);
  if (bundle) {
    // Stream the actual bundle: distinguishes two different builds with the same release version.
    const hash = createHash('sha256');
    const stream = createReadStream(typeof bundle === 'string' && bundle.startsWith('file:') ? new URL(bundle) : bundle);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => sink.write('build', [`bundle=${String(bundle)} sha256=${hash.digest('hex')}`]));
    stream.on('error', error => sink.write('warn', ['Cannot fingerprint runtime bundle', error]));
  }
  return { ...sink, async close() {
    if (console.warn === wrappers.warn) console.warn = originals.warn;
    if (console.error === wrappers.error) console.error = originals.error;
    process.off('uncaughtExceptionMonitor', fatal);
    releaseOutputPipes();
    await sink.flush();
  } };
}
