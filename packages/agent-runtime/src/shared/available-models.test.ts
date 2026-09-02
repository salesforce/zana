import { describe, expect, it } from 'vitest';
import { parseAvailableModelList } from './available-models.js';

describe('parseAvailableModelList', () => {
  it('preserves session-advertised ACP modes verbatim', () => {
    expect(parseAvailableModelList({
      models: [],
      selectedOnlyModels: [],
      acpMode: {
        currentValue: 'build',
        options: [
          { value: 'build', name: 'Build' },
          { value: 'plan', name: 'Plan' }
        ]
      }
    }).acpMode).toEqual({
      currentValue: 'build',
      options: [
        { value: 'build', name: 'Build' },
        { value: 'plan', name: 'Plan' }
      ]
    });
  });
});
