const displayCollator = new Intl.Collator('en', {
  usage: 'sort',
  sensitivity: 'base',
  numeric: true,
});

function compareCodePoints(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/** Nonmutating alphabetical order by visible base label; ties fall back to the stable id. */
export function sortHarnessDisplayRows<T>(
  rows: readonly T[],
  nameOf: (row: T) => string,
  idOf: (row: T) => string,
): T[] {
  return [...rows].sort((left, right) => {
    const byName = displayCollator.compare(nameOf(left), nameOf(right));
    if (byName !== 0) return byName;
    return compareCodePoints(idOf(left), idOf(right));
  });
}
