import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('AddLocalProjectDialog', () => {
  it('uses the shared setup frame for pages and legacy portaled dialogs', () => {
    const source = readFileSync(new URL('./AddLocalProjectDialog.tsx', import.meta.url), 'utf8');

    expect(source).toContain("SetupFrame as Modal");
    const frame = readFileSync(new URL('./setup/SetupFrame.tsx', import.meta.url), 'utf8');
    expect(frame).toContain('if (!page) return <Modal {...props} />');
    expect(source).toContain('<Modal');
    expect(source).not.toContain('className="modal-backdrop"');
  });
});
