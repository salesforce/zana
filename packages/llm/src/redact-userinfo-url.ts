const WHITESPACE = /\s/;

function isAsciiLetter(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isWordChar(code: number): boolean {
  return isAsciiLetter(code) || (code >= 48 && code <= 57) || code === 95;
}

function isSchemeChar(code: number): boolean {
  // [a-z0-9+.-], case-insensitive
  return isAsciiLetter(code) || (code >= 48 && code <= 57) || code === 43 || code === 46 || code === 45;
}

/**
 * Replace every `scheme://user:pass@host` URL with `replacement`.
 *
 * Linear replacement for /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@[^\s/]+/gi,
 * which CodeQL flags (js/polynomial-redos): on a long run of scheme characters
 * with no `://` the regex retried the scheme from every word boundary. Here the
 * text is searched once for `://` and each candidate is checked left to right.
 */
export function redactUserinfoUrls(text: string, replacement: string): string {
  let out = '';
  let cursor = 0;
  let searchFrom = 0;
  for (;;) {
    const sep = text.indexOf('://', searchFrom);
    if (sep < 0) break;
    searchFrom = sep + 3;

    // Scheme: leftmost letter in the scheme-character run that ends at `sep`
    // and starts on a word boundary (never before the previous replacement).
    let runStart = sep;
    while (runStart > cursor && isSchemeChar(text.charCodeAt(runStart - 1))) runStart -= 1;
    let start = -1;
    for (let p = runStart; p < sep; p += 1) {
      if (isAsciiLetter(text.charCodeAt(p)) && (p === 0 || !isWordChar(text.charCodeAt(p - 1)))) {
        start = p;
        break;
      }
    }
    if (start < 0) continue;

    // user: one or more of [^\s/@:], then ':'
    let i = sep + 3;
    while (i < text.length && !WHITESPACE.test(text[i]!) && '/@:'.indexOf(text[i]!) < 0) i += 1;
    if (i === sep + 3 || text[i] !== ':') continue;
    // password: one or more of [^\s/@], then '@'
    let j = i + 1;
    while (j < text.length && !WHITESPACE.test(text[j]!) && '/@'.indexOf(text[j]!) < 0) j += 1;
    if (j === i + 1 || text[j] !== '@') continue;
    // host: one or more of [^\s/]
    let k = j + 1;
    while (k < text.length && !WHITESPACE.test(text[k]!) && text[k] !== '/') k += 1;
    if (k === j + 1) continue;

    out += text.slice(cursor, start) + replacement;
    cursor = k;
    searchFrom = k;
  }
  return out + text.slice(cursor);
}
