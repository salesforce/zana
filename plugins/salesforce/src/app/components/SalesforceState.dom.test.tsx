/** @vitest-environment happy-dom */
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { EmptyState, LoadingState, SalesforceState } from './SalesforceState.js';
import { SoqlResultsGrid } from '../soql/SoqlResultsGrid.js';

afterEach(cleanup);

it('announces loading, keeps artwork decorative, and makes empty-state actions usable', () => {
  const create = vi.fn();
  const view = render(<LoadingState />);
  expect(screen.getByRole('status').textContent).toBe('Loading Salesforce…');
  expect(view.container.querySelector('.sf-state-art')?.getAttribute('aria-hidden')).toBe('true');
  view.rerender(<EmptyState compact art="agents" title="Start your first agent" action={<button onClick={create}>Create agent</button>}>Saved locally in this project.</EmptyState>);
  expect(screen.queryByRole('status')).toBeNull();
  expect(screen.getByRole('heading', { name: 'Start your first agent' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Create agent' }));
  expect(create).toHaveBeenCalledOnce();
  view.rerender(<SalesforceState kind="error" title="Org unavailable">Reconnect and try again.</SalesforceState>);
  expect(screen.getByRole('alert').textContent).toContain('Reconnect and try again.');
});

it('distinguishes query loading, no results, and filtered rows without discarding loaded data', () => {
  const select = vi.fn();
  const props = { records: [], search: '', onSelectRecord: select };
  const view = render(<SoqlResultsGrid {...props} />);
  expect(screen.getByRole('heading', { name: 'Run a query to see records.' })).toBeTruthy();
  view.rerender(<SoqlResultsGrid {...props} busy />);
  expect(screen.getByRole('status').textContent).toContain('Running your query');
  expect(screen.queryByText('No records matched this query.')).toBeNull();
  view.rerender(<SoqlResultsGrid {...props} hasRun />);
  expect(screen.getByRole('heading', { name: 'No records matched this query.' })).toBeTruthy();
  const records = [{ Id: '001', Name: 'Acme' }];
  view.rerender(<SoqlResultsGrid {...props} hasRun records={records} busy />);
  expect(screen.queryByRole('status')).toBeNull();
  expect(screen.getByRole('button', { name: 'Acme' })).toBeTruthy();
  view.rerender(<SoqlResultsGrid {...props} hasRun records={records} search="missing" />);
  expect(screen.getByRole('heading', { name: 'No matching rows' })).toBeTruthy();
  view.rerender(<SoqlResultsGrid {...props} hasRun records={records} />);
  fireEvent.click(screen.getByRole('button', { name: 'Acme' }));
  expect(select).toHaveBeenCalledWith(records[0]);
});
