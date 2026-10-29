import { clearStudioRunWorkspaces } from '../studio/run-workspaces.js';
/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PreviewSuite } from './PreviewSuite.js';
import type { ScenarioSuite } from '../../../lib/studio-contract.js';

vi.mock('@zana-ai/zcc-plugin-sdk/app', () => ({ callPluginRpc: vi.fn(async () => ({ ok: false, error: 'Recording expired' })) }));
afterEach(cleanup);
const suite: ScenarioSuite = {
  id: 'GuiAgentReview', path: 'tests/GuiAgentReview.scenario.json',
  cases: ['Credit offers require quote context', 'Capabilities are clear', 'Order lookup distinguishes missing records', 'Recipient review can be resumed'].map((name, i) => ({ id: String(i), name, utterances: ['hello'], expect: {} })),
  lastResults: { '0': { outcome: 'fail', runId: 'r', at: 1 }, '1': { outcome: 'pass', runId: 'r', at: 1 }, '2': { outcome: 'inconclusive', runId: 'r', at: 1 } }
};
describe('Preview scenario summary', () => {
  it('opens details from the name or action, restores focus, supports Escape and clears a filtered selection', () => {
    render(<PreviewSuite pluginId="salesforce" suite={suite} busy="Running case…" disabled onRun={vi.fn()} />);
    const opener = screen.getByRole('button', { name: `View details for ${suite.cases[0].name}` });
    fireEvent.click(opener);
    const detail = screen.getByRole('region', { name: `Details for ${suite.cases[0].name}` });
    expect(detail.textContent).toContain('Case inputs');
    fireEvent.keyDown(detail, { key: 'Escape' });
    expect(screen.queryByRole('region', { name: /Details for/ })).toBeNull();
    expect(document.activeElement).toBe(opener);
    const name = screen.getByRole('button', { name: `View details for ${suite.cases[0].name}` });
    fireEvent.click(name);
    fireEvent.click(screen.getByRole('button', { name: 'Close details' }));
    expect(screen.queryByRole('region', { name: /Details for/ })).toBeNull();
    fireEvent.click(name);
    fireEvent.click(name);
    expect(screen.queryByRole('region', { name: /Details for/ })).toBeNull();
    fireEvent.click(name);
    fireEvent.change(screen.getByLabelText('Scenario result filter'), { target: { value: 'pass' } });
    expect(screen.queryByRole('region', { name: /Details for/ })).toBeNull();
  });
  it('shows full names and filters in a dedicated scenario view', () => {
    const onRun = vi.fn();
    const { container } = render(<PreviewSuite pluginId="salesforce" suite={suite} busy="" disabled={false} onRun={onRun} />);
    expect(container.textContent).toContain('1/4 pass');
    expect(container.textContent).toContain('1 failed');
    expect(container.textContent).toContain('1 inconclusive');
    expect(container.textContent).toContain('1 not run');
    expect(screen.getByRole('region', { name: 'Scenario cases' })).toBeTruthy();
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
    expect(screen.getByRole('region', { name: 'Scenario cases' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Run 4 scenarios' }));
    expect(onRun).toHaveBeenLastCalledWith();
  });
  it('keeps counts current, disables reruns for active conversations and shows suite progress', () => {
    const onRun = vi.fn();
    const props = { suite, busy: '', disabled: true, onRun };
    const { rerender, container } = render(<PreviewSuite pluginId="salesforce" {...props} />);
    expect([...container.querySelectorAll('.sf-pw-suite-case button[aria-label^=Rerun]')].every(button => (button as HTMLButtonElement).disabled)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Run 4 scenarios' }));
    expect(onRun).not.toHaveBeenCalled();
    rerender(<PreviewSuite pluginId="salesforce" {...props} disabled={false} busy="Running case…" />);
    expect(screen.getByRole('status').textContent).toBe('Running case…');
    fireEvent.click(screen.getByRole('button', { name: `Rerun ${suite.cases[0].name}` }));
    expect(onRun).not.toHaveBeenCalled();
    rerender(<PreviewSuite pluginId="salesforce" {...props} suite={{ ...suite, lastResults: {} }} disabled={false} />);
    expect(container.textContent).toContain('0/4 pass');
    expect(container.textContent).toContain('4 not run');
    for (const filter of ['pass', 'inconclusive', 'unrun']) fireEvent.change(screen.getByLabelText('Scenario result filter'), { target: { value: filter } });
    expect(container.querySelectorAll('.sf-pw-suite-case')).toHaveLength(4);
  });
  it('explains a blocked run, returns to the conversation and stops the active suite', () => {
    const onConversation = vi.fn(), onStop = vi.fn();
    const props = { pluginId: 'salesforce', suite, busy: '', disabled: true, onRun: vi.fn(), onConversation };
    const { rerender } = render(<PreviewSuite {...props} disabledReason="End the conversation first." />);
    expect(screen.getByText('End the conversation first.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Return to conversation' }));
    expect(onConversation).toHaveBeenCalledOnce();
    rerender(<PreviewSuite {...props} disabled={false} busy="Running…" onStop={onStop} />);
    fireEvent.click(screen.getByRole('button', { name: 'Stop suite' }));
    expect(onStop).toHaveBeenCalledOnce();
    rerender(<PreviewSuite {...props} busy="Running…" onStop={onStop} stopping />);
    expect((screen.getByRole('button', { name: 'Stopping…' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('handles empty and loading suites without a misleading progress bar', () => {
    const { rerender, container } = render(<PreviewSuite pluginId="salesforce" suite={null} busy="Loading suite…" disabled={false} onRun={vi.fn()} />);
    expect(container.textContent).toContain('No saved results');
    rerender(<PreviewSuite pluginId="salesforce" suite={{ ...suite, cases: [] }} busy="" disabled={false} onRun={vi.fn()} />);
    expect((container.querySelector('.sf-pw-suite-meter i') as HTMLElement).style.width).toBe('0%');
    expect(screen.getByRole('status').textContent).toContain('No saved scenarios');
    expect((screen.getByRole('button', { name: 'Run 0 scenarios' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
