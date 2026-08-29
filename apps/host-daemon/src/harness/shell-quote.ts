/**
 * POSIX shell quoting for assembling remote command lines.
 *
 * This is a dependency-free LEAF module on purpose: both `pty.ts` and the
 * launch providers (`claude-code-provider.ts`, `shell-provider.ts`) need it,
 * and `pty.ts` imports the providers — so the helper cannot live in `pty.ts`
 * (that would be a cycle) nor in a provider (the other provider + pty.ts would
 * both need it). It moved out of `pty.ts` verbatim during the LaunchProvider
 * seam extraction; behaviour is unchanged.
 */

/**
 * Wrap `s` in single quotes and escape any embedded single quote. Used to
 * safely inject `cd <path>` and to assemble argv into the remote command line
 * handed to ssh.
 */
export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Quote each argv element and join with spaces. */
export function shellQuoteArgv(argv: string[]): string {
  return argv.map(shellQuote).join(' ');
}

/**
 * The `cd <startPath> && ` prefix shared by every remote launch, or `''` when
 * no start path is configured (land in the remote $HOME). Start-path precedence
 * is resolved by the caller; this only formats the prefix.
 */
export function remoteCdPrefix(startPath: string | undefined): string {
  return startPath ? `cd ${shellQuote(startPath)} && ` : '';
}
