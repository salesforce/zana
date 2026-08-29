export function previousQueuedIdAfterReorder(
  ids: readonly string[],
  activeId: string,
  overId: string
): string | null | undefined {
  if (activeId === overId) return undefined;
  const from = ids.indexOf(activeId);
  const to = ids.indexOf(overId);
  if (from < 0 || to < 0) return undefined;
  const next = ids.filter((id) => id !== activeId);
  next.splice(to, 0, activeId);
  const index = next.indexOf(activeId);
  return index <= 0 ? null : next[index - 1] ?? null;
}
