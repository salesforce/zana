import { describe, expect, it } from 'vitest';
import { PROJECT_ICONS, isProjectIcon } from './project-icons.js';

describe('project icons', () => {
  it('accepts the shared catalogue', () => {
    expect(new Set(PROJECT_ICONS).size).toBe(PROJECT_ICONS.length);
    for (const icon of PROJECT_ICONS) expect(isProjectIcon(icon)).toBe(true);
  });
  it.each([undefined, null, 5, '', 'cloud', 'Home', '<svg/>', 'https://example.com/icon.svg'])('rejects unsupported value %s', value => {
    expect(isProjectIcon(value)).toBe(false);
  });
});
