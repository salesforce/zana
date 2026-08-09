// POSIX shell single-quote escape: wrap in '...' and escape embedded single quotes
// as '\''. Safe to paste into bash/zsh/fish.
export function posixQuote(s: string): string {
  if (s === '') return "''";
  if (/^[A-Za-z0-9_\-./@:+,=%]+$/.test(s)) return s; // safe bareword
  return "'" + s.replace(/'/g, "'\\''") + "'";
}
