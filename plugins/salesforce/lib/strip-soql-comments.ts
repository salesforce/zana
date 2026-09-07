/** True when `line`'s first non-whitespace characters are a `#` or `--` marker. */
export function isSoqlCommentLine(line: string): boolean {
  return /^\s*(#|--)/.test(line);
}

/**
 * Blank full-line `#` / `--` comments so Salesforce error line numbers stay aligned.
 * Inline markers after other tokens are left untouched.
 */
export function stripSoqlComments(soql: string): string {
  if (!soql) return soql;
  return soql
    .split(/\r?\n/)
    .map((line) => (isSoqlCommentLine(line) ? '' : line))
    .join('\n');
}
