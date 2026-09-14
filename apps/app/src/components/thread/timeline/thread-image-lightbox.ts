export interface ThreadLightboxItem {
  src: string;
  alt: string;
}

export function resolveLightboxSelection(
  items: readonly ThreadLightboxItem[],
  selectedSrc: string | null | undefined
): ThreadLightboxItem | null {
  if (items.length === 0) return null;
  if (selectedSrc) {
    const match = items.find((item) => item.src === selectedSrc);
    if (match) return match;
  }
  return items[Math.max(0, items.length - 1)] ?? null;
}

export function mergeLightboxItems(
  items: readonly ThreadLightboxItem[],
  extra: ThreadLightboxItem | null | undefined
): ThreadLightboxItem[] {
  const next: ThreadLightboxItem[] = [];
  const seen = new Set<string>();
  const push = (item: ThreadLightboxItem) => {
    if (!item.src || seen.has(item.src)) return;
    seen.add(item.src);
    next.push(item);
  };
  for (const item of items) push(item);
  if (extra) push(extra);
  return next;
}
