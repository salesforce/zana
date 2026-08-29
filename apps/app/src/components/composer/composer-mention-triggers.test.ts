import { describe, expect, it } from 'vitest';
import {
  composerTriggersForMentionProviders,
  mentionProviderMatchesTrigger,
  mentionProviderTriggerChars
} from './composer-mention-triggers.js';

describe('composer mention triggers', () => {
  it('defaults a provider with no triggers to @', () => {
    expect(mentionProviderTriggerChars({})).toEqual(['@']);
    expect(mentionProviderMatchesTrigger({}, '@')).toBe(true);
    expect(mentionProviderMatchesTrigger({}, '#')).toBe(false);
  });

  it('honors triggers and the deprecated single trigger field', () => {
    expect(mentionProviderTriggerChars({ triggers: ['@', '#'] })).toEqual(['@', '#']);
    expect(mentionProviderTriggerChars({ trigger: '#' })).toEqual(['#']);
    expect(mentionProviderMatchesTrigger({ triggers: ['#'] }, '#')).toBe(true);
  });

  it('adds plugin trigger chars to the composer trigger list', () => {
    expect(composerTriggersForMentionProviders([])).toEqual([
      { char: '@', kind: 'mention' },
      { char: '/', kind: 'command' }
    ]);
    expect(composerTriggersForMentionProviders([{ triggers: ['#', '@'] }])).toEqual([
      { char: '#', kind: 'mention' },
      { char: '@', kind: 'mention' },
      { char: '/', kind: 'command' }
    ]);
  });
});
