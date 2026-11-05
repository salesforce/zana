import { expect, it } from 'vitest';
import { entries } from '../entries/global';

it('summarizes trusted preview folders as a count', () => {
  const entry = entries.find((e) => e.id === 'global.trusted-preview-folders-intro')!;
  const value = entry.value as (s: any) => string;
  expect(value({ config: {} })).toBe('None');
  expect(value({ config: { trustedPreviewFolders: [] } })).toBe('None');
  expect(value({ config: { trustedPreviewFolders: ['/a'] } })).toBe('1 folder');
  expect(value({ config: { trustedPreviewFolders: ['/a', '/b'] } })).toBe('2 folders');
});
