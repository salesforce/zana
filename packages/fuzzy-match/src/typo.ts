/**
 * Typo tolerance for short words: optimal string alignment distance, i.e.
 * Levenshtein plus adjacent transposition (`tmxu` -> `tmux` is ONE edit).
 */

/** Max edits tolerated for a word of `length` characters: none under 4, 1 for 4-7, 2 for 8+. */
export function typoMaxEdits(length: number): number {
  if (length < 4) {
    return 0;
  }
  return length < 8 ? 1 : 2;
}

/**
 * Optimal-string-alignment distance between `a` and `b`. When the distance
 * exceeds `maxDistance` the scan stops early and `maxDistance + 1` is returned,
 * so callers can compare against their own threshold cheaply.
 */
export function typoDistance(
  a: string,
  b: string,
  maxDistance = Number.POSITIVE_INFINITY,
): number {
  if (a === b) {
    return 0;
  }
  const n = a.length;
  const m = b.length;
  if (Math.abs(n - m) > maxDistance) {
    return maxDistance + 1;
  }
  if (n === 0 || m === 0) {
    return Math.max(n, m);
  }

  let twoBack = new Array<number>(m + 1).fill(0);
  let previous = Array.from({ length: m + 1 }, (_, j) => j);
  let current = new Array<number>(m + 1).fill(0);

  for (let i = 1; i <= n; i += 1) {
    current[0] = i;
    let rowMin = i;
    for (let j = 1; j <= m; j += 1) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      let value = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + cost,
      );
      if (
        i > 1 &&
        j > 1 &&
        a.charCodeAt(i - 1) === b.charCodeAt(j - 2) &&
        a.charCodeAt(i - 2) === b.charCodeAt(j - 1)
      ) {
        value = Math.min(value, twoBack[j - 2] + 1);
      }
      current[j] = value;
      if (value < rowMin) {
        rowMin = value;
      }
    }
    if (rowMin > maxDistance) {
      return maxDistance + 1;
    }
    [twoBack, previous, current] = [previous, current, twoBack];
  }

  const distance = previous[m];
  return distance > maxDistance ? maxDistance + 1 : distance;
}
