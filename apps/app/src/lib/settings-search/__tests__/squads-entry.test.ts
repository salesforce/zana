import { expect, it } from 'vitest';
import { entries } from '../entries/squads';

it('summarizes the All Squads launch mode, reading a missing value as Follow caller', () => {
  const entry = entries.find((e) => e.id === 'squads.default-launch-mode')!;
  const value = entry.value as (s: any) => string;
  expect(value({ config: {} })).toBe('Follow caller');
  expect(value({ config: { squadDefaultTransport: 'follow' } })).toBe('Default launch mode');
  expect(value({ config: { squadDefaultTransport: 'MODERN' } })).toBe('Modern');
  expect(value({ config: { squadDefaultTransport: 'CLI' } })).toBe('CLI Agent');
});
