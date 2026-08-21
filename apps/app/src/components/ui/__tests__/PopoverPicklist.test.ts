import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const source = readFileSync(
  join(fileURLToPath(new URL('../../../../../../packages/ui/src/popover-picklist.tsx', import.meta.url))),
  'utf8'
);

describe('PopoverPicklist', () => {
  it('supports disabled choices and keyboard navigation without restoring native selects', () => {
    expect(source).toContain('disabled?: boolean');
    expect(source).toContain('aria-haspopup="listbox"');
    expect(source).toContain('aria-activedescendant');
    expect(source).toContain("event.key === 'ArrowDown'");
    expect(source).toContain("event.key === 'ArrowUp'");
    expect(source).toContain("event.key === 'Enter'");
    expect(source).toContain('const spaceBelow = window.innerHeight - rect.bottom - 8');
    expect(source).toContain('const openAbove = spaceBelow < 160 && spaceAbove > spaceBelow');
    expect(source).not.toContain('<select');
  });
});
