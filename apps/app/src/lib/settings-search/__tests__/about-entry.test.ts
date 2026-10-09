import { expect, it } from 'vitest';
import entries from '../entries/about';

it('reports the update-simulation toggle as On or Off', () => {
  const entry = entries.find((e) => e.id === 'about.update-simulation')!;
  const value = entry.value as (s: any) => string;
  expect(value({ config: { enableUpdateSimulation: true } })).toBe('On');
  expect(value({ config: { enableUpdateSimulation: false } })).toBe('Off');
  expect(value({ config: {} })).toBe('Off');
});
