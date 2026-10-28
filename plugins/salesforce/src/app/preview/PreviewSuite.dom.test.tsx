/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PreviewSuite } from './PreviewSuite.js';
import type { ScenarioSuite } from '../../../lib/studio-contract.js';

afterEach(cleanup);
const suite: ScenarioSuite = {
  id: 'GuiAgentReview', path: 'tests/GuiAgentReview.scenario.json',
  cases: ['Credit offers require quote context', 'Capabilities are clear', 'Order lookup distinguishes missing records', 'Recipient review can be resumed'].map((name, i) => ({ id: String(i), name, utterances: ['hello'], expect: {} })),
  lastResults: { '0': { outcome: 'fail', runId: 'r', at: 1 }, '1': { outcome: 'pass', runId: 'r', at: 1 }, '2': { outcome: 'inconclusive', runId: 'r', at: 1 } }
};
describe('Preview scenario summary', () => {
  it('starts compact and exposes full names with result and search filters', () => {
    const onRun = vi.fn();
    const { container } = render(<PreviewSuite suite={suite} busy="" disabled={false} onRun={onRun} />);
    expect(container.textContent).toContain('1/4 pass');
    expect(container.textContent).toContain('1 failed');
    expect(container.textContent).toContain('1 inconclusive');
    expect(container.textContent).toContain('1 not run');
    expect(screen.queryByRole('region')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Inspect 4 cases/ }));
    expect(screen.getByRole('button', { name: /Inspect/ }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText(suite.cases[0].name)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Scenario result filter'), { target: { value: 'fail' } });
    expect(container.querySelectorAll('.sf-pw-suite-case')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: `Rerun ${suite.cases[0].name}` }));
    expect(onRun).toHaveBeenCalledWith(['0']);
    fireEvent.change(screen.getByLabelText('Search scenarios'), { target: { value: 'no match' } });
    expect(screen.getByRole('status').textContent).toContain('No scenarios match');
    fireEvent.change(screen.getByLabelText('Scenario result filter'), { target: { value: 'all' } });
    fireEvent.change(screen.getByLabelText('Search scenarios'), { target: { value: '  CAPABILITIES  ' } });
    expect(container.querySelectorAll('.sf-pw-suite-case')).toHaveLength(1);
    expect(screen.getByText('Capabilities are clear')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Inspect/ }));
    expect(screen.queryByRole('region')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Run suite' }));
    expect(onRun).toHaveBeenLastCalledWith();
  });
  it('keeps counts current, disables reruns for active/Live runs and shows suite progress', () => {
    const onRun = vi.fn();
    const props = { suite, busy: '', disabled: true, onRun };
    const { rerender, container } = render(<PreviewSuite {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /Inspect/ }));
    expect([...container.querySelectorAll('.sf-pw-suite-case button')].every(button => (button as HTMLButtonElement).disabled)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Run suite' }));
    expect(onRun).not.toHaveBeenCalled();
    rerender(<PreviewSuite {...props} disabled={false} busy="Running case…" />);
    expect(screen.getByRole('status').textContent).toBe('Running case…');
    fireEvent.click(screen.getByRole('button', { name: `Rerun ${suite.cases[0].name}` }));
    expect(onRun).not.toHaveBeenCalled();
    rerender(<PreviewSuite {...props} suite={{ ...suite, lastResults: {} }} disabled={false} />);
    expect(container.textContent).toContain('0/4 pass');
    expect(container.textContent).toContain('4 not run');
    for (const filter of ['pass', 'inconclusive', 'unrun']) fireEvent.change(screen.getByLabelText('Scenario result filter'), { target: { value: filter } });
    expect(container.querySelectorAll('.sf-pw-suite-case')).toHaveLength(4);
  });
  it('handles empty and loading suites without a misleading progress bar', () => {
    const { rerender, container } = render(<PreviewSuite suite={null} busy="Loading suite…" disabled={false} onRun={vi.fn()} />);
    expect(container.textContent).toContain('Scenario suite');
    rerender(<PreviewSuite suite={{ ...suite, cases: [] }} busy="" disabled={false} onRun={vi.fn()} />);
    expect((container.querySelector('.sf-pw-suite-meter i') as HTMLElement).style.width).toBe('0%');
    fireEvent.click(screen.getByRole('button', { name: /Inspect/ }));
    expect(screen.getByRole('status').textContent).toContain('No scenarios match');
  });
});
