import type { ExecutionSourceCapabilityView, TeamJobRenewedSources } from '@zana-ai/zcc-domain/product';

const FALLBACK_NAME = 'a source';

function droppedNotice(reason: TeamJobRenewedSources['dropped'][number]['reason'], name: string | undefined): string {
  switch (reason) {
    case 'moved':
    case 'unreadable':
      return `Attach ${name ?? FALLBACK_NAME} again; it moved or can't be read.`;
    case 'too-large':
      return `${name ?? 'A source'} is now too large. Attach a smaller file.`;
    default:
      return `Attach ${name ?? FALLBACK_NAME} again; it is no longer available.`;
  }
}

/**
 * Merge the capabilities a failed launch re-issued into the composer's attachment chips.
 * Chips keep their position; only ids still present are touched, so a chip the user
 * removed while the launch was in flight stays removed.
 */
export function applyRenewedSources(
  current: ExecutionSourceCapabilityView[],
  renewal: TeamJobRenewedSources
): { sources: ExecutionSourceCapabilityView[]; notices: string[] } {
  const renewed = new Map(renewal.renewed.map((entry) => [entry.previousId, entry]));
  const dropped = new Set(renewal.dropped.map(({ previousId }) => previousId));
  const nameOf = (id: string) => current.find((chip) => chip.id === id)?.name || undefined;
  const present = new Set(current.map(({ id }) => id));
  const seen = new Set<string>();
  const sources = current.flatMap((chip) => {
    if (dropped.has(chip.id)) return [];
    const next = renewed.get(chip.id)?.source ?? chip;
    if (seen.has(next.id)) return [];
    seen.add(next.id);
    return [next];
  });
  // Only chips still on screen need a word; one the user removed mid-launch stays quiet.
  const notices = [
    ...renewal.dropped.filter((entry) => present.has(entry.previousId))
      .map((entry) => droppedNotice(entry.reason, entry.name ?? nameOf(entry.previousId))),
    ...renewal.renewed.filter((entry) => entry.changed && present.has(entry.previousId))
      .map((entry) => `${entry.source.name} changed since you attached it. Launching again uses the current version.`)
  ];
  return { sources, notices };
}
