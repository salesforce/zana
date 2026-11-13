/**
 * Display helpers for filesystem paths in the renderer.
 *
 * The sidebar lists projects with their full path under the name, but those
 * paths share a long common prefix (`/Users/<me>/Documents/…`) that gets
 * truncated to an identical, useless `…/Documen…` on every row. These helpers
 * tildify the home dir and keep the *distinguishing tail* instead.
 */

const WINDOWS_ABSOLUTE_PATH = /^(?:[A-Za-z]:[\\/]|\\\\)/;

/**
 * Example absolute path for a folder-path input, in the target machine's
 * format. The daemon-reported home dir decides when it is known; otherwise a
 * local machine falls back to the renderer's platform and a remote one to
 * POSIX (SSH remotes are almost always Linux/macOS).
 */
export function folderPathPlaceholder(
  host: { homeDir?: string | null; isPrimary: boolean } | undefined,
  platform = typeof navigator === 'undefined' ? '' : navigator.platform
): string {
  const windows = host?.homeDir
    ? WINDOWS_ABSOLUTE_PATH.test(host.homeDir)
    : (host?.isPrimary ?? true) && platform.toUpperCase().startsWith('WIN');
  return windows ? 'C:\\path\\to\\project' : '/path/to/project';
}

/** Replace a leading home-dir prefix with `~`. No-op if `home` is empty. */
export function tildify(path: string, home: string | undefined): string {
  if (!home) return path;
  if (path === home) return '~';
  const prefix = home.endsWith('/') ? home : `${home}/`;
  return path.startsWith(prefix) ? `~/${path.slice(prefix.length)}` : path;
}

/**
 * Shorten a project path for a one-line label, keeping the tail that actually
 * distinguishes it. First tildifies `home`, then — if there are more than
 * `keepTail` trailing segments — collapses the middle to `…`:
 *
 *   /Users/me/Documents/work/parrot  →  ~/…/work/parrot   (home known)
 *   /opt/srv/apps/a/b/c              →  /opt/…/b/c        (home unknown)
 *
 * `keepTail` defaults to 2 (the project folder + its parent), which is enough
 * to tell sibling checkouts apart. The leading anchor (`~` or the filesystem
 * root segment) is always preserved so the path stays recognizable.
 */
export function shortenProjectPath(path: string, home: string | undefined, keepTail = 2): string {
  const tilded = tildify(path, home);
  const segments = tilded.split('/');
  // Anchor is `~`, '' (from a leading slash → absolute), or the first segment.
  const anchor = segments[0];
  const rest = segments.slice(1).filter(Boolean);
  if (rest.length <= keepTail) return tilded;
  const tail = rest.slice(-keepTail).join('/');
  const head = anchor === '' ? `/${rest[0]}` : anchor;
  return `${head}/…/${tail}`;
}

/**
 * `path` relative to `root`, with `/` separators, or null when `path` isn't
 * strictly inside `root`. Under a Windows root (drive letter or UNC) `\` and
 * `/` are both separators, so `C:/repo` and the host's `C:\repo\a.ts` match.
 * Under a POSIX root only `/` is, because `\` is an ordinary filename
 * character there. The root prefix ignores case under a Windows root, where
 * `C:\Repo` and `c:\repo` are the same folder; POSIX compares it exactly.
 */
export function relativeUnder(root: string, path: string): string | null {
  const windows = WINDOWS_ABSOLUTE_PATH.test(root);
  const norm = (value: string) => (windows ? value.replace(/\\/g, '/') : value);
  const base = norm(root).replace(/\/+$/, '');
  const target = norm(path);
  if (target.length <= base.length + 1) return null;
  const prefix = target.slice(0, base.length + 1);
  const expected = base + '/';
  if (windows ? prefix.toLowerCase() !== expected.toLowerCase() : prefix !== expected) return null;
  return target.slice(base.length + 1);
}

/**
 * Parent folder of `path`, or '' when there is none. `\` splits only when
 * `root` is a Windows path; on a POSIX root it stays part of the name.
 */
export function parentPath(path: string, root: string): string {
  const last = WINDOWS_ABSOLUTE_PATH.test(root) ? Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) : path.lastIndexOf('/');
  return path.slice(0, Math.max(last, 0));
}
