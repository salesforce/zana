import { describe, expect, it } from 'vitest';
import {
  buildFuzzyRegex,
  buildModelNavRows,
  fuzzyFilter,
  matchesModelQuery,
  modelQueryScore,
  modelSearchText,
  pinSelectedMoreModels,
  splitModelLabelTag
} from './model-picker-search.js';

describe('model picker search', () => {
  it('splits a trailing parenthetical tag off the model label', () => {
    expect(splitModelLabelTag('Opus 5 (1M)')).toEqual({ base: 'Opus 5', tag: '1M' });
    expect(splitModelLabelTag('Sonnet 5')).toEqual({ base: 'Sonnet 5', tag: null });
  });

  it('fuzzy-matches compact model labels', () => {
    expect(buildFuzzyRegex('sn5').test('Sonnet 5')).toBe(true);
    expect(fuzzyFilter(
      [{ value: 'claude-sonnet-5', label: 'Sonnet 5' }, { value: 'claude-fable-5', label: 'Fable 5' }],
      'sn',
      (option) => option.label
    )).toEqual([{ value: 'claude-sonnet-5', label: 'Sonnet 5' }]);
    expect(matchesModelQuery('Sonnet 5', 'sn5')).toBe(true);
  });

  it('does not letter-skip openai onto unrelated openrouter ids', () => {
    const openai = {
      value: 'openai/gpt-5',
      label: 'openai/gpt-5',
      routeProviderId: 'openai'
    };
    const viaOpenRouter = {
      value: 'openrouter/openai/gpt-5',
      label: 'openrouter/openai/gpt-5',
      routeProviderId: 'openrouter'
    };
    const reka = {
      value: 'openrouter/rekaai/reka-flash-3',
      label: 'openrouter/rekaai/reka-flash-3',
      routeProviderId: 'openrouter'
    };
    const relace = {
      value: 'openrouter/relace/relace-apply-3',
      label: 'openrouter/relace/relace-apply-3',
      routeProviderId: 'openrouter'
    };
    const search = (option: typeof openai) => modelSearchText(option, 'pi');
    expect(matchesModelQuery(search(reka), 'openai')).toBe(false);
    expect(matchesModelQuery(search(relace), 'openai')).toBe(false);
    expect(fuzzyFilter([reka, relace, viaOpenRouter, openai], 'openai', search)).toEqual([
      openai,
      viaOpenRouter
    ]);
    expect(modelQueryScore(search(openai), 'openai')).toBeGreaterThan(
      modelQueryScore(search(viaOpenRouter), 'openai')
    );
  });

  it('matches hyphen-stripped ids and provider segments', () => {
    expect(matchesModelQuery('openai/gpt-5', 'gpt5')).toBe(true);
    expect(matchesModelQuery('openrouter/anthropic/claude-sonnet-4.6', 'anthropic')).toBe(true);
  });

  it('pins a selected more-model into the primary list', () => {
    const models = [{ value: 'a', label: 'A' }];
    const more = [{ value: 'b', label: 'B' }, { value: 'c', label: 'C' }];
    expect(pinSelectedMoreModels(models, more, 'c')).toEqual({
      modelOptions: [models[0], more[1]],
      moreModelOptions: [more[0]]
    });
    expect(pinSelectedMoreModels(models, more, 'a')).toEqual({
      modelOptions: models,
      moreModelOptions: more
    });
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
