import { expect, it } from 'vitest';
import type { AppConfig } from '@zana-ai/zcc-domain/product';
import { entries } from '../entries/experimental.js';
import { searchSettings } from '../index.js';

it.each([undefined, true, false])('finds Thread tabs with its effective value: %s', enabled => {
  const snapshot = { config: { threadTabsEnabled: enabled } as AppConfig };
  const entry = entries.find(row => row.id === 'experimental.thread-tabs')!;
  expect(entry.value!(snapshot)).toBe((enabled ?? true) ? 'On' : 'Off');
  expect(searchSettings('thread tabs', snapshot, { entries })[0]!.entry.id).toBe(entry.id);
  expect(entry.anchor).toBe('experimental-features');
});

it.each([undefined, true, false])('finds Dockable thread tools with its effective value: %s', enabled => {
  const snapshot = { config: { dockableThreadToolsEnabled: enabled } as AppConfig };
  const entry = entries.find(row => row.id === 'experimental.dockable-thread-tools')!;
  expect(entry.value!(snapshot)).toBe((enabled ?? true) ? 'On' : 'Off');
  expect(searchSettings('dock terminal bottom', snapshot, { entries })[0]!.entry.id).toBe(entry.id);
  expect(entry.anchor).toBe('experimental-features');
});

it('does not offer the standard inset workspace as an experimental setting', () => {
  expect(entries.some(row => row.id === 'experimental.inset-workspace')).toBe(false);
  expect(searchSettings('inset workspace', { config: {} as AppConfig }, { entries })).toEqual([]);
});
