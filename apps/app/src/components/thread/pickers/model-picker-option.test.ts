import { describe, expect, it } from 'vitest';
import { availableModelsToPickerOptions } from './model-picker-option.js';

describe('availableModelsToPickerOptions', () => {
  it('maps catalog rows the way Thread and CLI Agent pickers consume them', () => {
    expect(availableModelsToPickerOptions([
      { model: 'claude-sonnet-5', displayName: 'Sonnet 5' },
      { model: 'haiku', displayName: 'Haiku Alias (Legacy)', routeProviderId: 'anthropic' }
    ])).toEqual([
      { value: 'claude-sonnet-5', label: 'Sonnet 5' },
      { value: 'haiku', label: 'Haiku Alias (Legacy)', routeProviderId: 'anthropic' }
    ]);
  });
});
