import { describe, expect, it } from 'vitest';
import { providerFor } from '../registry.js';
import {
  adapterBindsInitialTask,
  initialTaskDeliveryState,
  stdinOpeningPrompt
} from '../initial-task.js';

describe('stdinOpeningPrompt', () => {
  it('returns the trimmed prompt for mastracode (TUI cannot take --prompt argv)', () => {
    expect(stdinOpeningPrompt({
      provider: providerFor('mastracode'),
      profile: 'mastracode',
      prompt: '  analyse the repo  ',
      scope: 'local'
    })).toBe('analyse the repo');
    expect(stdinOpeningPrompt({
      provider: providerFor('mastracode-yolo'),
      profile: 'mastracode-yolo',
      prompt: 'analyse the repo',
      scope: 'remote'
    })).toBe('analyse the repo');
  });

  it('stays off for spawn-arg harnesses, shell, empty prompts, and resume', () => {
    expect(stdinOpeningPrompt({
      provider: providerFor('claude'),
      profile: 'claude',
      prompt: 'do the thing',
      scope: 'local'
    })).toBeUndefined();
    expect(stdinOpeningPrompt({
      provider: providerFor('opencode'),
      profile: 'opencode',
      prompt: 'do the thing',
      scope: 'local'
    })).toBeUndefined();
    expect(stdinOpeningPrompt({
      provider: providerFor('shell'),
      profile: 'shell',
      prompt: 'echo hi',
      scope: 'local'
    })).toBeUndefined();
    expect(stdinOpeningPrompt({
      provider: providerFor('mastracode'),
      profile: 'mastracode',
      prompt: '   ',
      scope: 'local'
    })).toBeUndefined();
    expect(stdinOpeningPrompt({
      provider: providerFor('mastracode'),
      profile: 'mastracode',
      prompt: 'analyse the repo',
      scope: 'local',
      resume: true
    })).toBeUndefined();
    expect(stdinOpeningPrompt({
      provider: providerFor('mastracode-resume'),
      profile: 'mastracode-resume',
      prompt: 'analyse the repo',
      scope: 'local',
      resume: true
    })).toBeUndefined();
  });
});

describe('adapterBindsInitialTask', () => {
  it('accepts argv-bound spawn-arg adapters and mastracode stdin-after-ready', () => {
    expect(adapterBindsInitialTask(providerFor('claude'), 'local')).toBe(true);
    expect(adapterBindsInitialTask(providerFor('opencode'), 'remote')).toBe(true);
    expect(adapterBindsInitialTask(providerFor('mastracode'), 'local')).toBe(true);
    expect(adapterBindsInitialTask(providerFor('mastracode'), 'remote')).toBe(true);
    expect(adapterBindsInitialTask(providerFor('shell'), 'local')).toBe(false);
  });

  it('stamps Team delivery as attempted for stdin-after-ready', () => {
    expect(initialTaskDeliveryState(providerFor('claude'), 'local')).toBe('bound-at-spawn');
    expect(initialTaskDeliveryState(providerFor('mastracode'), 'local')).toBe('delivery-attempted');
  });
});
