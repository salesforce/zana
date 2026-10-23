/**
 * Ownership and mode bits are only meaningful on POSIX. On Windows Node reports `uid` 0 and a synthetic `mode`
 * (0o666/0o777 whatever the NTFS ACLs say), so callers keep only the symlink, link-count, size, file-type and
 * content checks there.
 */
export const posixPermissions = (): boolean => process.platform !== 'win32' && typeof process.getuid === 'function';
