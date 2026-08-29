import { describe, expect, it } from 'vitest';
import { cursorModelsFromListOutput } from '../cursor-model-catalog.js';

describe('cursorModelsFromListOutput', () => {
  it('folds effort variants into one family and keeps Grok 4.6 on the live catalog', () => {
    expect(cursorModelsFromListOutput([
      'auto - Auto (default)',
      'cursor-grok-4.5-high - Cursor Grok 4.5',
      'cursor-grok-4.6-low - Cursor Grok 4.6 Low',
      'cursor-grok-4.6-medium - Cursor Grok 4.6 Medium',
      'cursor-grok-4.6-high - Cursor Grok 4.6',
      'cursor-grok-4.5-medium - Cursor Grok 4.5 Medium',
      'gpt-5.6-sol-medium - GPT-5.6 Sol 1M'
    ].join('\n'))).toEqual([
      { id: 'auto', label: 'Auto', scope: ['local'] },
      { id: 'cursor-grok-4.5-medium', label: 'Cursor Grok 4.5', scope: ['local'] },
      { id: 'cursor-grok-4.6-medium', label: 'Cursor Grok 4.6', scope: ['local'] },
      { id: 'gpt-5.6-sol-medium', label: 'GPT-5.6 Sol', scope: ['local'] }
    ]);
  });
});
