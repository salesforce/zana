const SCHEME = "bearer";

function isLineTerminator(code: number): boolean {
  return code === 10 || code === 13 || code === 0x2028 || code === 0x2029;
}

/**
 * Token from an `Authorization: Bearer <token>` header, or undefined.
 *
 * Replaces `/^Bearer\s+(.+)$/i`, which CodeQL flags (js/polynomial-redos): a
 * long whitespace run followed by a line terminator made it backtrack
 * quadratically. The scheme is case-insensitive, needs at least one whitespace
 * character, and the token is the remaining text, which may not contain a line
 * terminator and may not be empty.
 */
export function parseBearerToken(header: string | undefined): string | undefined {
  if (!header || header.length <= SCHEME.length) return undefined;
  if (header.slice(0, SCHEME.length).toLowerCase() !== SCHEME) return undefined;
  if (!/\s/.test(header[SCHEME.length]!)) return undefined;
  let start = SCHEME.length;
  while (start < header.length && /\s/.test(header[start]!)) start += 1;
  if (start >= header.length) return undefined;
  for (let i = start; i < header.length; i += 1) {
    if (isLineTerminator(header.charCodeAt(i))) return undefined;
  }
  return header.slice(start);
}
