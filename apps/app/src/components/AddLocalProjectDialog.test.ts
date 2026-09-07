import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('AddLocalProjectDialog', () => {
  it('uses the portaled modal primitive so board headers cannot cover its backdrop', () => {
    const source = readFileSync(new URL('./AddLocalProjectDialog.tsx', import.meta.url), 'utf8');

    expect(source).toContain("import { Modal } from './Modal.js'");
    expect(source).toContain('<Modal');
    expect(source).not.toContain('className="modal-backdrop"');
  });
});
