/** @vitest-environment happy-dom */
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SimulationScenarios, type EditableScenario } from './SimulationScenarios.js';

afterEach(cleanup);
const row = (key: string, name = key): EditableScenario => ({ key, name, persona: `Customer ${key}`, goal: `Resolve ${key}`, opening: 'Help me', criteria: 'Resolve the request', maxTurns: 3 });
function Harness({ initial = [row('Returns'), row('Orders')], disabled = false }: { initial?: EditableScenario[]; disabled?: boolean }) {
  const [rows, setRows] = useState(initial);
  const [included, setIncluded] = useState(initial.map(row => row.key));
  const [activeKey, setActive] = useState(initial[0]?.key ?? '');
  return <SimulationScenarios scenarios={rows} included={included} activeKey={activeKey} disabled={disabled} attention={new Set(['Returns'])}
    onSelect={setActive} onToggle={key => setIncluded(keys => keys.includes(key) ? keys.filter(k => k !== key) : [...keys, key])}
    onEdit={(key, patch) => setRows(rows => rows.map(row => row.key === key ? { ...row, ...patch } : row))}
    onAdd={() => { setRows(rows => [...rows, row('New')]); setActive('New'); }} onRemove={key => setRows(rows => rows.filter(row => row.key !== key))} />;
}
it('focuses one scenario, retains edits across selections and independently includes conversations', () => {
  render(<Harness />);
  expect(screen.getAllByRole('textbox').length).toBe(6);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Returns' }));
  expect((screen.getByRole('checkbox', { name: 'Returns' }) as HTMLInputElement).checked).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Edit Orders' }));
  for (const field of ['name', 'persona', 'goal', 'opening', 'criteria']) fireEvent.change(screen.getByLabelText(`Scenario 2 ${field}`), { target: { value: `${field} edited` } });
  fireEvent.change(screen.getByLabelText('Scenario 2 maximum turns'), { target: { value: '6' } });
  fireEvent.click(screen.getByRole('button', { name: 'Edit Returns' }));
  fireEvent.click(screen.getByRole('button', { name: 'Edit name edited' }));
  expect((screen.getByLabelText('Scenario 2 criteria') as HTMLTextAreaElement).value).toBe('criteria edited');
  expect((screen.getByLabelText('Scenario 2 maximum turns') as HTMLInputElement).value).toBe('6');
});
it('searches, filters failures and clears filters when creating a scenario', () => {
  render(<Harness />);
  fireEvent.change(screen.getByLabelText('Search scenarios'), { target: { value: 'customer ORD' } });
  expect(screen.queryByRole('button', { name: 'Edit Returns' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Edit Orders' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Needs attention' }));
  expect(screen.getByText('No scenarios need attention.')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Search scenarios'), { target: { value: '' } });
  expect(screen.getByRole('button', { name: 'Edit Returns' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Edit Orders' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'All 2' }));
  fireEvent.change(screen.getByLabelText('Search scenarios'), { target: { value: 'missing' } });
  expect(screen.getByText('No matching scenarios.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Add scenario' }));
  expect((screen.getByLabelText('Search scenarios') as HTMLInputElement).value).toBe('');
  expect(screen.getByRole('button', { name: 'Edit Orders' })).toBeTruthy();
  expect((screen.getByLabelText('Scenario 3 name') as HTMLInputElement).value).toBe('New');
});
it('falls back after removal, handles an empty catalogue and supplies field placeholders', () => {
  render(<Harness initial={[{ ...row('Only', ''), goal: '' }]} />);
  expect(screen.getByText('Untitled scenario')).toBeTruthy();
  expect(screen.getByText('Define a customer goal')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Remove scenario 1' }));
  expect(screen.getByText('Create your first scenario')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Add your first scenario' }));
  expect(screen.getByRole('button', { name: 'Edit New' })).toBeTruthy();
});
it('locks editing during a run while preserving navigation and caps scenario creation', () => {
  const edit = vi.fn();
  const view = render(<Harness disabled />);
  expect((screen.getByRole('checkbox', { name: 'Returns' }) as HTMLInputElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: 'Add scenario' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByLabelText('Scenario 1 name').closest('fieldset')!.disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Edit Orders' }));
  expect(screen.getByLabelText('Scenario 2 name')).toBeTruthy();
  view.rerender(<SimulationScenarios scenarios={Array.from({ length: 12 }, (_, i) => row(String(i)))} included={[]} activeKey="0" attention={new Set()} disabled={false} onSelect={vi.fn()} onToggle={vi.fn()} onEdit={edit} onAdd={vi.fn()} onRemove={vi.fn()} />);
  expect((screen.getByRole('button', { name: 'Add scenario' }) as HTMLButtonElement).disabled).toBe(true);
});
