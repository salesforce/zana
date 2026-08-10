import { describe, expect, it } from 'vitest';
import { IPC } from '../ipc.js';

describe('editable extension import IPC contract', () => {
  it('has a dedicated main-owned folder adoption route', () => {
    expect(IPC.extensions.adoptLocal).toBe('extensions:adoptLocal');
  });
});
