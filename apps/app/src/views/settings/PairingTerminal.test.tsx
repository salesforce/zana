/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

const h = vi.hoisted(() => ({
  exitCb: null as null | ((code: number) => void),
  offExit: vi.fn(),
  offData: vi.fn()
}));

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    options = {};
    loadAddon() {}
    open() {}
    write() {}
    focus() {}
    dispose() {}
    onData() {}
  }
}));
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit() {}
    proposeDimensions() { return { cols: 80, rows: 24 }; }
  }
}));
vi.mock('../../lib/app-surface.js', () => ({ hasDesktopBridge: () => true }));
vi.mock('../../lib/product-client.js', () => ({
  product: {
    hosts: {
      pairing: {
        onData: () => h.offData,
        onExit: (cb: (code: number) => void) => { h.exitCb = cb; return h.offExit; },
        status: async () => ({ running: true, backlog: 'hi' }),
        resize: vi.fn(),
        write: vi.fn()
      }
    }
  }
}));

import { PairingTerminal } from './PairingTerminal.js';

class RO { observe() {} disconnect() {} }

afterEach(() => {
  cleanup();
  h.exitCb = null;
  h.offExit.mockClear();
  h.offData.mockClear();
});

describe('PairingTerminal', () => {
  it('forwards the PTY exit code to the caller', () => {
    vi.stubGlobal('ResizeObserver', RO);
    const onExit = vi.fn();
    render(<PairingTerminal onExit={onExit} />);
    h.exitCb?.(255);
    expect(onExit).toHaveBeenCalledWith(255);
  });

  it('ignores exit when no caller is registered and unsubscribes on unmount', () => {
    vi.stubGlobal('ResizeObserver', RO);
    const { unmount } = render(<PairingTerminal />);
    expect(() => h.exitCb?.(1)).not.toThrow();
    unmount();
    expect(h.offExit).toHaveBeenCalled();
    expect(h.offData).toHaveBeenCalled();
  });
});
