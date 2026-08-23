export type TypeaheadKeyAction = 'apply' | 'next' | 'prev' | 'dismiss' | 'none';

export function typeaheadKeyAction(event: {
  key: string;
  shiftKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
}): TypeaheadKeyAction {
  if (event.key === 'Escape') return 'dismiss';
  if (event.key === 'ArrowDown') return 'next';
  if (event.key === 'ArrowUp') return 'prev';
  if (event.key === 'Enter' || event.key === 'Tab') {
    if (event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return 'none';
    return 'apply';
  }
  return 'none';
}

export function nextSuggestionIndex(current: number, length: number, delta: number): number {
  if (length <= 0) return 0;
  return (current + delta + length) % length;
}

export function typeaheadMenuOpen(
  triggerKind: 'mention' | 'command' | null,
  suggestionCount: number,
  commandsLoaded: boolean
): boolean {
  if (triggerKind === 'mention') return true;
  if (triggerKind === 'command') return commandsLoaded && suggestionCount > 0;
  return false;
}
