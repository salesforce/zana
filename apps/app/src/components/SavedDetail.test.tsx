import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('SavedDetail empty', () => {
  const source = readFileSync(new URL('./SavedDetail.tsx', import.meta.url), 'utf8');

  it('uses PaneEmptyState and drops the debug project id', () => {
    expect(source).toContain('<PaneEmptyState');
    expect(source).toContain('art="inbox"');
    expect(source).not.toContain('inbox-detail-meta-id');
  });
});
