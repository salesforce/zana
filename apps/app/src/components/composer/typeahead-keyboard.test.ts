import { describe, expect, it } from 'vitest';
import {
  nextSuggestionIndex,
  typeaheadKeyAction,
  typeaheadMenuOpen
} from './typeahead-keyboard.js';

describe('typeaheadKeyAction', () => {
  it('maps arrows, apply keys, and escape', () => {
    expect(typeaheadKeyAction({ key: 'ArrowDown' })).toBe('next');
    expect(typeaheadKeyAction({ key: 'ArrowUp' })).toBe('prev');
    expect(typeaheadKeyAction({ key: 'Enter' })).toBe('apply');
    expect(typeaheadKeyAction({ key: 'Tab' })).toBe('apply');
    expect(typeaheadKeyAction({ key: 'Escape' })).toBe('dismiss');
    expect(typeaheadKeyAction({ key: 'a' })).toBe('none');
  });

  it('does not treat modified Enter as apply so composer submit can stay distinct', () => {
    expect(typeaheadKeyAction({ key: 'Enter', metaKey: true })).toBe('none');
    expect(typeaheadKeyAction({ key: 'Enter', shiftKey: true })).toBe('none');
  });
});

describe('nextSuggestionIndex', () => {
  it('wraps around the list', () => {
    expect(nextSuggestionIndex(0, 3, -1)).toBe(2);
    expect(nextSuggestionIndex(2, 3, 1)).toBe(0);
    expect(nextSuggestionIndex(0, 0, 1)).toBe(0);
  });
});

describe('typeaheadMenuOpen', () => {
  it('opens mentions even with an empty result list', () => {
    expect(typeaheadMenuOpen('mention', 0, true)).toBe(true);
  });

  it('opens commands even before the catalog loads so slash is never silent', () => {
    expect(typeaheadMenuOpen('command', 0, false)).toBe(true);
    expect(typeaheadMenuOpen('command', 0, true)).toBe(true);
    expect(typeaheadMenuOpen('command', 2, true)).toBe(true);
    expect(typeaheadMenuOpen(null, 2, true)).toBe(false);
  });
});
