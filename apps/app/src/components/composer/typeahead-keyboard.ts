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
  _suggestionCount: number,
  _commandsLoaded: boolean
): boolean {
  if (triggerKind === 'mention') return true;
  // Open as soon as `/` is the active trigger. An empty catalog still renders
  // "No matching commands" so slash is never a silent no-op.
  if (triggerKind === 'command') return true;
  return false;
}
