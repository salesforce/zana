import { describe, expect, it, vi } from 'vitest';
import { verifyTmux } from '../TerminalTab.js';

describe('TerminalTab tmux verification', () => {
  it('returns an accessible error state after a rejected verification', async () => {
    const check = vi.fn().mockRejectedValue(new Error('IPC unavailable'));

    await expect(verifyTmux(check)).resolves.toEqual({
      status: null,
      error: 'Could not check tmux: IPC unavailable'
    });
  });
});
