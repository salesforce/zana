/** @vitest-environment happy-dom */
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { contextEntries, ScenarioVariables } from './ScenarioVariables.js';
import { validateContextEntries, type ContextEntry, type ContextType, type PreviewContextVariable } from '../../../lib/preview-context.js';

afterEach(cleanup);
function Harness({ values = [] }: { values?: PreviewContextVariable[] }) {
  const [entries, setEntries] = useState<Record<string, ContextEntry>>(contextEntries(values));
  return <><ScenarioVariables entries={entries} inherited={[{ name: 'locale', type: 'Text', value: 'fr' }]}
    fields={[{ name: 'verified', label: 'Verified customer', type: 'Boolean', defaultValue: true }, { name: 'count', label: 'Count', type: 'Number', defaultValue: 0 }]}
    onChange={setEntries} /><output data-testid="values">{JSON.stringify(validateContextEntries(entries).values)}</output></>;
}
function add(name: string, type?: ContextType) {
  fireEvent.click(screen.getByRole('button', { name: 'Add variable' }));
  fireEvent.change(screen.getByLabelText('New scenario variable name'), { target: { value: name } });
  if (type) fireEvent.change(screen.getByLabelText('New scenario variable type'), { target: { value: type } });
  fireEvent.click(screen.getByRole('button', { name: 'Add override' }));
}
it('inherits batch values and discovers typed defaults without losing false, zero or null', () => {
  render(<Harness />);
  expect(screen.getByText(/1 variable inherited/)).toBeTruthy();
  add('locale'); expect((screen.getByLabelText('locale value') as HTMLInputElement).value).toBe('fr');
  fireEvent.change(screen.getByLabelText('locale value'), { target: { value: 'en' } });
  add('verified'); expect((screen.getByLabelText('verified value') as HTMLSelectElement).value).toBe('true');
  fireEvent.change(screen.getByLabelText('verified value'), { target: { value: 'false' } });
  add('count'); expect((screen.getByLabelText('count value') as HTMLInputElement).value).toBe('0');
  fireEvent.click(screen.getByLabelText('Set locale to null'));
  expect(screen.getByText('null')).toBeTruthy();
  expect(JSON.parse(screen.getByTestId('values').textContent!)).toEqual([{ name: 'locale', type: 'Text', value: null }, { name: 'verified', type: 'Boolean', value: false }, { name: 'count', type: 'Number', value: 0 }]);
  fireEvent.click(screen.getByLabelText('Set locale to null')); expect((screen.getByLabelText('locale value') as HTMLInputElement).value).toBe('en');
  fireEvent.click(screen.getByRole('button', { name: 'Reset locale to batch default' }));
  expect(screen.queryByLabelText('locale value')).toBeNull();
});
it.each([['Text', 'hello'], ['Boolean', 'false'], ['Number', '0'], ['Json', '{}'], ['List', '[]'], ['Object', '[]'], ['Date', '2026-10-29'], ['DateTime', '2026-10-29T00:00:00Z']] as const)('adds a manual %s variable with a typed editor', (type, value) => {
  render(<Harness />); add('manual', type);
  fireEvent.change(screen.getByLabelText('manual value'), { target: { value } });
  expect(JSON.parse(screen.getByTestId('values').textContent!)[0]).toMatchObject({ name: 'manual', type });
});
it('reports malformed values and refuses invalid or duplicate names', () => {
  render(<Harness />); add('invalid.name'); expect(screen.getByRole('alert').textContent).toContain('variable name');
  fireEvent.change(screen.getByLabelText('New scenario variable name'), { target: { value: 'json' } });
  fireEvent.change(screen.getByLabelText('New scenario variable type'), { target: { value: 'Json' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add override' }));
  fireEvent.change(screen.getByLabelText('json value'), { target: { value: '{' } });
  expect(screen.getByRole('alert').textContent).toBe('Enter valid JSON.');
  add('json'); expect(screen.getAllByRole('alert').map(row => row.textContent).join(' ')).toContain('already overridden');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add variable' }));
  fireEvent.keyDown(screen.getByLabelText('New scenario variable name'), { key: 'Escape' });
  expect(screen.queryByLabelText('New scenario variable name')).toBeNull();
});
it('caps overrides and reports combined payload issues', () => {
  const entries = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`v${i}`, { type: 'Text' as const, text: 'x' }]));
  const changed = vi.fn(); const view = render(<ScenarioVariables entries={entries} onChange={changed} />);
  add('extra'); expect(screen.getByRole('alert').textContent).toContain('at most 100'); expect(changed).not.toHaveBeenCalled();
  view.rerender(<ScenarioVariables entries={{ large: { type: 'Text', text: 'x'.repeat(64000) } }} onChange={changed} />);
  expect(screen.getAllByRole('alert').map(row => row.textContent).join(' ')).toContain('64 KB');
});
