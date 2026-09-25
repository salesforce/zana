import { describe, expect, it } from 'vitest';
import { IPC } from './ipc.js';

describe('menubar desktop compatibility', () => {
  it('keeps the shipped CLI focus channel beside discriminated agent focus', () => {
    expect(IPC.menubar.focusSession).toBe('menubar:focusSession');
    expect(IPC.menubar.focusAgent).toBe('menubar:focusAgent');
  });
});
