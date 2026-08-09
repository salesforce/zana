import { describe, expect, it } from 'vitest';
import { codexModelsFromResponse } from '../codex-model-catalog.js';

describe('codexModelsFromResponse', () => {
  it('uses Codex display names, excludes hidden models, and puts its default first', () => {
    expect(codexModelsFromResponse({
      data: [
        { id: 'gpt-5.4-mini', displayName: 'GPT-5.4 Mini', hidden: false, isDefault: false },
        { id: 'gpt-5.5', displayName: 'GPT-5.5', hidden: false, isDefault: true },
        { id: 'hidden', displayName: 'Hidden', hidden: true, isDefault: false }
      ]
    })).toEqual([
      { id: 'gpt-5.5', label: 'GPT-5.5', scope: ['local'] },
      { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini', scope: ['local'] }
    ]);
  });
});
