import { describe, it, expect, beforeEach } from 'vitest';
import {
  getActiveTerminalId,
  getFinder,
  getTerminal,
  markActiveTerminal,
  registerFinder,
  registerTerminal,
  releaseActiveTerminal
} from './findRegistry.js';

describe('findRegistry active terminal', () => {
  beforeEach(() => {
    const id = getActiveTerminalId();
    if (id) releaseActiveTerminal(id);
  });

  it('starts with no active terminal', () => {
    expect(getActiveTerminalId()).toBeNull();
  });

  it('marks and returns the active terminal id', () => {
    markActiveTerminal('a');
    expect(getActiveTerminalId()).toBe('a');
  });

  it('a later mark replaces the earlier one', () => {
    markActiveTerminal('a');
    markActiveTerminal('b');
    expect(getActiveTerminalId()).toBe('b');
  });

  it('releasing the active id clears it', () => {
    markActiveTerminal('a');
    releaseActiveTerminal('a');
    expect(getActiveTerminalId()).toBeNull();
  });

  it('a stale release of a non-active id does not clear the active one', () => {
    markActiveTerminal('a');
    markActiveTerminal('b');
    releaseActiveTerminal('a');
    expect(getActiveTerminalId()).toBe('b');
  });

  it('release with nothing active is a no-op', () => {
    releaseActiveTerminal('zzz');
    expect(getActiveTerminalId()).toBeNull();
  });
});

describe('findRegistry terminal handles', () => {
  it('registers, resolves and unregisters a handle', () => {
    const h = { clear: () => {} };
    const off = registerTerminal('t1', h);
    expect(getTerminal('t1')).toBe(h);
    off();
    expect(getTerminal('t1')).toBeNull();
  });

  it('a stale unregister does not drop a replacement handle', () => {
    const h1 = { clear: () => {} };
    const h2 = { clear: () => {} };
    const off1 = registerTerminal('t2', h1);
    const off2 = registerTerminal('t2', h2);
    off1();
    expect(getTerminal('t2')).toBe(h2);
    off2();
  });

  it('returns null for an undefined id', () => {
    expect(getTerminal(undefined)).toBeNull();
  });
});

describe('findRegistry finders', () => {
  const f = { findNext: () => true, findPrev: () => true, clear: () => {} };

  it('registers, resolves and unregisters a finder', () => {
    const off = registerFinder('f1', f);
    expect(getFinder('f1')).toBe(f);
    off();
    expect(getFinder('f1')).toBeNull();
  });

  it('a stale unregister keeps the replacement finder', () => {
    const f2 = { ...f };
    const off1 = registerFinder('f2', f);
    const off2 = registerFinder('f2', f2);
    off1();
    expect(getFinder('f2')).toBe(f2);
    off2();
  });

  it('returns null for an undefined id', () => {
    expect(getFinder(undefined)).toBeNull();
  });
});
