import { mentionDisplayLabel } from '../../composer/mention-label.js';

export function mentionPillLabel(mention: {
  resource?: { kind?: string; label?: string; path?: string; name?: string; entryKind?: string };
}): string {
  return mentionDisplayLabel(mention.resource);
}
