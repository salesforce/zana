import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('PopoverPicklist', () => {
  it('supports disabled choices and keyboard navigation without restoring native selects', () => {
    const source = readFileSync(new URL('../PopoverPicklist.tsx', import.meta.url), 'utf8');

    expect(source).toContain('disabled?: boolean');
    expect(source).toContain('aria-haspopup="listbox"');
    expect(source).toContain('aria-activedescendant');
    expect(source).toContain("event.key === 'ArrowDown'");
    expect(source).toContain("event.key === 'ArrowUp'");
    expect(source).toContain("event.key === 'Enter'");
    expect(source).not.toContain('<select');
  });
});
