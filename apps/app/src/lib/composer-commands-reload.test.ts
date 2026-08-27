import { afterEach, describe, expect, it, vi } from 'vitest';
import { COMPOSER_COMMANDS_RELOAD_EVENT, requestComposerCommandsReload } from './composer-commands-reload.js';

describe('requestComposerCommandsReload', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('dispatches a window event the composer can subscribe to', () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal('Event', class FakeEvent {
      type: string;
      constructor(type: string) {
        this.type = type;
      }
    });
    vi.stubGlobal('window', { dispatchEvent });
    requestComposerCommandsReload();
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    expect(dispatchEvent.mock.calls[0]?.[0]).toMatchObject({ type: COMPOSER_COMMANDS_RELOAD_EVENT });
  });
});
