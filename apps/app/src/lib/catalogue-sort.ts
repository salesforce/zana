const collator = new Intl.Collator('en', {
  usage: 'sort',
  sensitivity: 'accent',
  numeric: true,
});

export function sortCatalogueByName<T extends { id: string; name: string }>(items: readonly T[]): T[] {
  return items.slice().sort((left, right) => {
    const byName = collator.compare(left.name, right.name);
    if (byName !== 0) return byName;
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });
}
