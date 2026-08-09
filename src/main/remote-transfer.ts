import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { stat, mkdir } from 'node:fs/promises';
import { basename, dirname, posix } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { ProjectRemote, RemoteTransferResult } from '../shared/types.js';
import { confineRemote, sshBaseArgs, shellQuote } from './remote-fs.js';

/**
 * Bidirectional file transfer between the local machine and a remote (SSH)
 * project, streamed over the SAME multiplexed ssh connection the Explorer and
 * terminals already use (`sshBaseArgs` → ControlMaster socket). No `scp`/`sftp`
 * /`ssh2` dependency: we pipe the file body through `ssh … cat`, so a transfer
 * inherits the project's auth, host-key, and ProxyCommand behaviour for free.
 *
 * Both directions stream end-to-end (`createReadStream`/`createWriteStream` ↔
 * the ssh process's stdio) so a multi-hundred-MB file never sits in main's
 * heap. This is the bridge that makes a remote project usable: drop a local
 * file onto a remote terminal/Explorer and it lands on the devbox; pull a
 * remote file back down to edit or share it.
 *
 * Trust: callers in `index.ts` resolve `remote` + `root` from the store (never
 * the renderer). Remote destinations/sources are `confineRemote`'d under the
 * project root, exactly like the read/write ops in remote-fs.
 */

// Transfers tolerate much larger files than the 2 MB inline-edit cap (that cap
// is about not choking Monaco, not about the wire). Cap at 1 GB as a sanity
// backstop against an accidental drop of something enormous.
const MAX_TRANSFER_BYTES = 1024 * 1024 * 1024; // 1 GB
// A transfer can legitimately run far longer than a directory listing; size the
// idle/overall timeout generously. The stream is killed if it stalls.
const TRANSFER_TIMEOUT_MS = 10 * 60_000; // 10 min
// Subdir we stage uploads into, relative to the drop destination. Keeps dropped
// files from clobbering working files and is trivially .gitignore-able.
const UPLOAD_SUBDIR = '.zcc-uploads';

/** Sanitize a filename to a single safe path segment (no separators, no dots-only). */
function safeBasename(name: string): string {
  const base = basename(name).replace(/[/\\]/g, '_');
  if (!base || base === '.' || base === '..') return 'file';
  return base;
}

/**
 * Upload one local file to the remote, staging it under
 * `<destDir>/.zcc-uploads/<name>`. `destDir` is the drop target (a remote dir,
 * e.g. the session cwd); it and the staged path are confined under `root`.
 *
 * Collision handling: if `<name>` already exists we suffix ` (1)`, ` (2)`, …
 * before the extension rather than overwrite — a drop should never silently
 * clobber. The remote name probe + the streamed write run as ONE ssh command:
 * we resolve a free name with a small shell loop, print it, then `cat` stdin
 * into a temp and `mv` it into place (atomic; a dropped link truncates the temp,
 * never a real file). The chosen name is echoed on the first stdout line.
 */
export async function uploadToRemote(
  remote: ProjectRemote,
  root: string,
  localPath: string,
  destDir: string
): Promise<RemoteTransferResult> {
  let size: number;
  try {
    const st = await stat(localPath);
    if (!st.isFile()) return { ok: false, message: 'Only regular files can be uploaded' };
    size = st.size;
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
  if (size > MAX_TRANSFER_BYTES) {
    return { ok: false, message: `File too large to upload (${size} > ${MAX_TRANSFER_BYTES})` };
  }

  const stageDir = confineRemote(root, posix.join(destDir, UPLOAD_SUBDIR));
  if (!stageDir) return { ok: false, message: 'Destination is outside the project' };
  const name = safeBasename(localPath);
  // Split name/ext so the collision suffix lands before the extension.
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  const qDir = shellQuote(stageDir);
  const qStem = shellQuote(stem);
  const qExt = shellQuote(ext);
  // Resolve a non-colliding "<stem><suffix><ext>" under $d, print it on its own
  // line (consumed by the caller), then stream stdin → temp → mv.
  const cmd =
    `set -e; d=${qDir}; mkdir -p "$d"; ` +
    `n=${qStem}; x=${qExt}; f="$d/$n$x"; i=0; ` +
    `while [ -e "$f" ]; do i=$((i+1)); f="$d/$n ($i)$x"; done; ` +
    `printf '%s\\n' "$f"; ` +
    `t="$f.zcc-tmp.$$"; cat > "$t" && mv "$t" "$f"`;

  const args = [...sshBaseArgs(remote), cmd];
  return new Promise<RemoteTransferResult>((resolve) => {
    let settled = false;
    const done = (r: RemoteTransferResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };
    const proc = spawn('ssh', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let outBuf = '';
    let errBuf = '';
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      done({ ok: false, message: 'Upload timed out' });
    }, TRANSFER_TIMEOUT_MS);
    proc.stdout.on('data', (d: Buffer) => {
      // Only the first line (the chosen path) matters; cap to avoid growth.
      if (outBuf.length < 8192) outBuf += d.toString('utf8');
    });
    proc.stderr.on('data', (d: Buffer) => {
      if (errBuf.length < 8192) errBuf += d.toString('utf8');
    });
    proc.on('error', (err) => done({ ok: false, message: err.message }));
    proc.on('close', (code) => {
      if (code === 0) {
        const finalPath = outBuf.split('\n')[0]?.trim();
        done({ ok: true, path: finalPath || posix.join(stageDir, name), bytes: size });
      } else {
        done({ ok: false, message: errBuf.trim() || `Upload failed (exit ${code})` });
      }
    });
    // Stream the local file into ssh's stdin. A stdin EPIPE (remote died early)
    // is surfaced by the close handler; swallow the raw event.
    proc.stdin.on('error', () => {});
    const rs = createReadStream(localPath);
    rs.on('error', (err) => {
      proc.kill('SIGKILL');
      done({ ok: false, message: err.message });
    });
    rs.pipe(proc.stdin);
  });
}

/**
 * Download one remote file to a local path, streaming `ssh … cat "$remote"`
 * into a local write stream. `remotePath` is confined under `root`; `localPath`
 * is chosen by the caller (an OS save dialog in the IPC layer). We probe the
 * remote is a regular file first so `cat` of a directory can't dump garbage.
 */
export async function downloadFromRemote(
  remote: ProjectRemote,
  root: string,
  remotePath: string,
  localPath: string
): Promise<RemoteTransferResult> {
  const src = confineRemote(root, remotePath);
  if (!src) return { ok: false, message: 'Source is outside the project' };
  const q = shellQuote(src);
  // Guard non-regular files; exit 3 distinguishes "not a file" from cat errors.
  const cmd = `test -f ${q} || exit 3; cat ${q}`;
  const args = [...sshBaseArgs(remote), cmd];

  try {
    await mkdir(dirname(localPath), { recursive: true });
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }

  return new Promise<RemoteTransferResult>((resolve) => {
    let settled = false;
    const done = (r: RemoteTransferResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };
    const proc = spawn('ssh', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let errBuf = '';
    let bytes = 0;
    let overflow = false;
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      done({ ok: false, message: 'Download timed out' });
    }, TRANSFER_TIMEOUT_MS);
    proc.stderr.on('data', (d: Buffer) => {
      if (errBuf.length < 8192) errBuf += d.toString('utf8');
    });
    proc.stdout.on('data', (d: Buffer) => {
      bytes += d.length;
      if (bytes > MAX_TRANSFER_BYTES && !overflow) {
        overflow = true;
        proc.kill('SIGKILL');
      }
    });
    const ws = createWriteStream(localPath);
    ws.on('error', (err) => {
      proc.kill('SIGKILL');
      done({ ok: false, message: err.message });
    });
    proc.on('error', (err) => done({ ok: false, message: err.message }));
    // Pipe stdout → file; let the write stream finish before we report success.
    pipeline(proc.stdout, ws).catch(() => {
      /* surfaced via ws 'error' or the close handler below */
    });
    proc.on('close', (code) => {
      if (overflow) {
        done({ ok: false, message: `File too large to download (> ${MAX_TRANSFER_BYTES})` });
        return;
      }
      if (code === 0) {
        done({ ok: true, path: localPath, bytes });
      } else if (code === 3) {
        done({ ok: false, message: 'Not a regular file' });
      } else {
        done({ ok: false, message: errBuf.trim() || `Download failed (exit ${code})` });
      }
    });
  });
}
