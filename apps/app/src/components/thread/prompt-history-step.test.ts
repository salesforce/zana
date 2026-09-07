import { describe, expect, it } from 'vitest';
import { promptHistoryTexts, stepPromptHistory } from './prompt-history-step.js';

describe('stepPromptHistory', () => {
  const entries = ['first', 'second', 'third'];

  it('ArrowUp from the live draft recalls the newest entry', () => {
    expect(stepPromptHistory({
      key: 'ArrowUp',
      entries,
      index: -1,
      currentText: 'draft',
      draft: 'draft'
    })).toEqual({ index: 2, text: 'third', draft: 'draft' });
  });

  it('ArrowDown from the newest entry restores the draft', () => {
    expect(stepPromptHistory({
      key: 'ArrowDown',
      entries,
      index: 2,
      currentText: 'third',
      draft: 'draft'
    })).toEqual({ index: -1, text: 'draft', draft: 'draft' });
  });

  it('walks older entries with ArrowUp', () => {
    expect(stepPromptHistory({
      key: 'ArrowUp',
      entries,
      index: 2,
      currentText: 'third',
      draft: 'draft'
    })).toEqual({ index: 1, text: 'second', draft: 'draft' });
  });
});

describe('promptHistoryTexts', () => {
  it('extracts text parts newest-last', () => {
    expect(promptHistoryTexts([
      { input: [{ type: 'text', text: 'hello' }] },
      { input: [{ type: 'text', text: '  ' }] }
    ])).toEqual(['hello']);
  });
});
