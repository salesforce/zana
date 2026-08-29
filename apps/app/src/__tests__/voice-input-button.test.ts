import { describe, it, expect } from 'vitest';

describe('VoiceInputButton module', () => {
  it('exports VoiceInputButton as a named export', async () => {
    const mod = await import('../components/VoiceInputButton.js');
    expect(mod.VoiceInputButton).toBeDefined();
    expect(typeof mod.VoiceInputButton).toBe('function');
  });
});
