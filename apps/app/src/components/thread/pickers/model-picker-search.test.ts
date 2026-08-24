import { describe, expect, it } from 'vitest';
import {
  buildFuzzyRegex,
  buildModelNavRows,
  fuzzyFilter,
  splitModelLabelTag
} from './model-picker-search.js';

describe('model picker search', () => {
  it('splits a trailing parenthetical tag off the model label', () => {
    expect(splitModelLabelTag('Opus 5 (1M)')).toEqual({ base: 'Opus 5', tag: '1M' });
    expect(splitModelLabelTag('Sonnet 5')).toEqual({ base: 'Sonnet 5', tag: null });
  });

  it('fuzzy-matches model labels', () => {
    expect(buildFuzzyRegex('sn5').test('Sonnet 5')).toBe(true);
    expect(fuzzyFilter(
      [{ value: 'claude-sonnet-5', label: 'Sonnet 5' }, { value: 'claude-fable-5', label: 'Fable 5' }],
      'sn',
      (option) => option.label
    )).toEqual([{ value: 'claude-sonnet-5', label: 'Sonnet 5' }]);
  });

  it('folds more-models into the list while searching', () => {
    const models = [{ value: 'a', label: 'A' }];
    const more = [{ value: 'b', label: 'B' }];
    expect(buildModelNavRows({
      modelOptions: models,
      moreModelOptions: more,
      isSearching: false
    })).toEqual([
      { kind: 'model', option: models[0] },
      { kind: 'more-toggle' }
    ]);
    expect(buildModelNavRows({
      modelOptions: models,
      moreModelOptions: more,
      isSearching: true
    })).toEqual([
      { kind: 'model', option: models[0] },
      { kind: 'model', option: more[0] }
    ]);
  });
});
