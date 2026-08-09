/**
 * Display helpers for filesystem paths in the renderer.
 *
 * The sidebar lists projects with their full path under the name, but those
 * paths share a long common prefix (`/Users/<me>/Documents/…`) that gets
 * truncated to an identical, useless `…/Documen…` on every row. These helpers
 * tildify the home dir and keep the *distinguishing tail* instead.
 */

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
