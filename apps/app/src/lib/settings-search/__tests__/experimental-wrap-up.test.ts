import { expect, it } from 'vitest';
import { entries } from '../entries/experimental';

const find = (id: string) => entries.find((e) => e.id === id)!;

it('lists the wrap-up toggle with a value that reads On / Off', () => {
  const toggle = find('experimental.close-wrap-up');
  expect(toggle.label).toBe('Wrap up before closing');
  expect(toggle.kind).toBe('setting');
  const value = toggle.value as (s: any) => string;
  expect(value({ config: {} })).toBe('Off');
  expect(value({ config: { closeWrapUpEnabled: false } })).toBe('Off');
  expect(value({ config: { closeWrapUpEnabled: true } })).toBe('On');
});

it('lists the instructions row as depending on the toggle', () => {
  const row = find('experimental.close-wrap-up-instructions');
  expect(row.label).toBe('Instructions sent to the agent');
  expect(row.kind).toBe('setting');
  expect(row.dependsOn).toBe('experimental.close-wrap-up');
  expect(row.keywords).toEqual(['wrap up', 'self-learn', 'close with follow-up', 'instructions']);
});
