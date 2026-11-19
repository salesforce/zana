import { expect, it } from 'vitest';
import { isSessionViewed } from '../agent-tab-status.js';

it('counts a session as viewed when selected in its project or when its page is the open route', () => {
  const sel = { selectedProjectId: 'p', selectedTabId: { p: 's1' } };
  expect(isSessionViewed('s1', 'p', sel, null)).toBe(true);
  expect(isSessionViewed('s1', 'q', sel, null)).toBe(false);
  expect(isSessionViewed('s2', 'p', sel, null)).toBe(false);
  expect(isSessionViewed('s2', 'p', sel, 's2')).toBe(true);
});
