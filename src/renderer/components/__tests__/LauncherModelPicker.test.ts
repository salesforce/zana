import { describe, expect, it } from 'vitest';
import type { HarnessModelTarget } from '@shared/harness-adapter';
import { matchingLauncherModels } from '../LauncherModelPicker.js';

const models: HarnessModelTarget[] = Array.from({ length: 7 }, (_, index) => ({
  id: `gpt-${index + 1}`,
  label: `GPT ${index + 1}`,
  scope: ['local']
}));

describe('matchingLauncherModels', () => {
  it('keeps the default picker concise while search includes the full catalog', () => {
    expect(matchingLauncherModels(models, '')).toHaveLength(6);
    expect(matchingLauncherModels(models, 'gpt-7')).toEqual([models[6]]);
    expect(matchingLauncherModels(models, 'GPT 3')).toEqual([models[2]]);
  });
});
