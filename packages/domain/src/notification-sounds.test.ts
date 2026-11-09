import { expect, it } from 'vitest';
import { normalizeNotificationSoundProvider, notificationSoundProvider, notificationSoundsEnabled } from './product.js';
it('accepts bounded provider references and rejects paths, malformed values and oversized ids', () => {
  for (const key of ['builtin', 'custom-voices/main', 'vendor.plugin/voice_2']) expect(normalizeNotificationSoundProvider(key)).toBe(key);
  for (const key of [null, {}, 1, '', 'builtin/../../file', '/tmp/sounds', 'plugin/', 'plugin/slot space', 'x'.repeat(257) + '/main']) expect(normalizeNotificationSoundProvider(key)).toBeUndefined();
  expect(notificationSoundProvider({})).toBe('builtin');
  expect(notificationSoundProvider({ notificationSoundProvider: 'voices/main' })).toBe('voices/main');
});
it('preserves legacy chime enablement and lets an explicit master override it', () => {
  expect(notificationSoundsEnabled({})).toBe(false);
  expect(notificationSoundsEnabled({ agentSoundNeedsYou: true })).toBe(true);
  expect(notificationSoundsEnabled({ agentSoundIdle: true })).toBe(true);
  expect(notificationSoundsEnabled({ agentSoundIdle: true, notificationSoundsEnabled: false })).toBe(false);
  expect(notificationSoundsEnabled({ notificationSoundsEnabled: true })).toBe(true);
  // Adding the new completed-turn alert must not opt a fresh profile into audio.
  const completionOnly = { agentSoundDone: true, agentSoundNeedsYou: false };
  expect(notificationSoundsEnabled(completionOnly)).toBe(false);
});
