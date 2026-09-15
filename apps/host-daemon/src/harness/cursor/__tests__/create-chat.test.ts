import { describe, expect, it } from 'vitest';
import { createCursorChatMinter } from '../create-chat.js';

describe('cursorChatMinter', () => {
  it('returns the UUID from create-chat stdout', async () => {
    const minter = createCursorChatMinter({
      runCreateChat: async () => 'created chat 11111111-2222-3333-4444-555555555555 extra'
    });
    await expect(minter.mint('cursor-agent', '/tmp')).resolves.toBe(
      '11111111-2222-3333-4444-555555555555'
    );
  });

  it('returns undefined when the probe fails or prints no uuid', async () => {
    const missing = createCursorChatMinter({ runCreateChat: async () => null });
    await expect(missing.mint('cursor-agent', '/tmp')).resolves.toBeUndefined();
    const junk = createCursorChatMinter({ runCreateChat: async () => 'no id here' });
    await expect(junk.mint('cursor-agent', '/tmp')).resolves.toBeUndefined();
  });
});
