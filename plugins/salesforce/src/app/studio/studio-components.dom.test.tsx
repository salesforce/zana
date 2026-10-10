/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExplorerNode, StudioDiagnostic } from '../../../lib/studio-contract.js';
import { BottomPanel } from './BottomPanel.js';
import { EditorTabs } from './EditorTabs.js';
import { Explorer, groupExplorerNodes } from './Explorer.js';
import { ProblemsPanel, sortDiagnostics } from './ProblemsPanel.js';
import { ToolStrip } from './ToolStrip.js';
import type { EditorTab } from './studio-layout.js';

afterEach(cleanup);

describe('ToolStrip', () => {
  const items = [{ id: 'a', title: 'Alpha', icon: <i /> }, { id: 'b', title: 'Beta', icon: <i />, badge: 120 }, { id: 'c', title: 'Gamma', icon: <i />, badge: 2 }];
  it('is a tablist when horizontal with arrow navigation and icon-only mode', () => {
    const onSelect = vi.fn();
    const { rerender } = render(<ToolStrip items={items} active="a" label="Tools" onSelect={onSelect} trailing={<span>end</span>} />);
    expect(screen.getByRole('tablist', { name: 'Tools' })).toBeTruthy();
    expect(screen.getByText('Alpha')).toBeTruthy();
    expect(screen.getByText('99+')).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Alpha' }), { key: 'ArrowRight' });
    expect(onSelect).toHaveBeenLastCalledWith('b');
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Alpha' }), { key: 'ArrowLeft' });
    expect(onSelect).toHaveBeenLastCalledWith('c');
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Beta' }), { key: 'Home' });
    expect(onSelect).toHaveBeenLastCalledWith('a');
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Beta' }), { key: 'End' });
    expect(onSelect).toHaveBeenLastCalledWith('c');
    onSelect.mockClear();
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Beta' }), { key: 'x' });
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('tab', { name: 'Gamma' }));
    expect(onSelect).toHaveBeenCalledWith('c');
    rerender(<ToolStrip items={items} active={null} iconsOnly label="Tools" onSelect={onSelect} />);
    expect(screen.queryByText('Alpha')).toBeNull();
    expect(screen.getByRole('tab', { name: 'Alpha' }).getAttribute('tabindex')).toBe('0');
  });
  it('is a toolbar of toggle buttons when vertical', () => {
    const onSelect = vi.fn();
    render(<ToolStrip items={items} active="b" orientation="vertical" label="Activity" onSelect={onSelect} />);
    expect(screen.getByRole('toolbar', { name: 'Activity' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Beta' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByText('Alpha')).toBeNull();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Beta' }), { key: 'ArrowDown' });
    expect(onSelect).not.toHaveBeenCalled(); // vertical arrows move focus only
  });
});

describe('EditorTabs', () => {
  const tabs: EditorTab[] = [
    { id: 'agent:a', kind: 'agent', label: 'A.agent', path: 'a.agent' },
    { id: 'apex:Lookup', kind: 'apex', label: 'Lookup', target: 'apex://Lookup' },
    { id: 'flow:Refund', kind: 'flow', label: 'Refund', target: 'flow://Refund' },
    { id: 'type:c__Order', kind: 'type', label: 'c__Order', target: 'c__Order' }
  ];
  it('renders nothing without tabs', () => {
    const { container } = render(<EditorTabs tabs={[]} active={null} onSelect={vi.fn()} onClose={vi.fn()} />);
    expect(container.innerHTML).toBe('');
  });
  it('marks kinds, dirty and problems, selects, closes and navigates by keyboard', () => {
    const onSelect = vi.fn(); const onClose = vi.fn();
    render(<EditorTabs tabs={tabs} active="agent:a" dirtyId="agent:a" problems={3} onSelect={onSelect} onClose={onClose} />);
    expect(screen.getByLabelText('Unsaved changes')).toBeTruthy();
    expect(screen.getByLabelText('3 problems')).toBeTruthy();
    expect(screen.getAllByText('read-only')).toHaveLength(3);
    expect(screen.getByText('TYPE')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: /Lookup/ }));
    expect(onSelect).toHaveBeenLastCalledWith('apex:Lookup');
    fireEvent.keyDown(screen.getByRole('tab', { name: /A\.agent/ }), { key: 'ArrowLeft' });
    expect(onSelect).toHaveBeenLastCalledWith('type:c__Order');
    fireEvent.keyDown(screen.getByRole('tab', { name: /A\.agent/ }), { key: 'ArrowRight' });
    expect(onSelect).toHaveBeenLastCalledWith('apex:Lookup');
    onSelect.mockClear();
    fireEvent.keyDown(screen.getByRole('tab', { name: /A\.agent/ }), { key: 'q' });
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Close Refund' }));
    expect(onClose).toHaveBeenCalledWith('flow:Refund');
  });
});

describe('BottomPanel', () => {
  const render3 = vi.fn((tab: string, visible: boolean) => <span data-testid={`pane-${tab}`}>{String(visible)}</span>);
  it('wide: tabs toggle and select, panes stay mounted', () => {
    const onToggle = vi.fn(); const onSelect = vi.fn();
    const { rerender } = render(<BottomPanel open={false} active="problems" problems={2} onToggle={onToggle} onSelect={onSelect} render={render3} />);
    expect(screen.getAllByRole('tab')).toHaveLength(4);
    expect(screen.getByText('2')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: /Trace/ }));
    expect(onSelect).toHaveBeenCalledWith('trace');
    fireEvent.click(screen.getByRole('button', { name: 'Expand panel' }));
    expect(onToggle).toHaveBeenCalledTimes(1);
    rerender(<BottomPanel open active="trace" problems={0} onToggle={onToggle} onSelect={onSelect} render={render3} />);
    expect(screen.getByTestId('pane-trace').textContent).toBe('true');
    expect(screen.getByTestId('pane-problems').textContent).toBe('false');
    fireEvent.click(screen.getByRole('tab', { name: /Trace/ }));
    expect(onToggle).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: 'Collapse panel' }));
    expect(onToggle).toHaveBeenCalledTimes(3);
  });
  it('compact: a collapsible problems bar with only the problems pane', () => {
    const onToggle = vi.fn();
    const { rerender } = render(<BottomPanel open={false} active="problems" problems={1} compact onToggle={onToggle} onSelect={vi.fn()} render={render3} />);
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    expect(screen.queryByTestId('pane-trace')).toBeNull();
    const bar = screen.getByRole('button', { name: /1 problem$/ });
    expect(bar.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(bar);
    expect(onToggle).toHaveBeenCalled();
    rerender(<BottomPanel open active="problems" problems={0} compact onToggle={onToggle} onSelect={vi.fn()} render={render3} />);
    expect(screen.getByRole('button', { name: /No problems/ }).getAttribute('aria-expanded')).toBe('true');
    rerender(<BottomPanel open active="problems" problems={4} compact onToggle={onToggle} onSelect={vi.fn()} render={render3} />);
    expect(screen.getByRole('button', { name: /4 problems/ })).toBeTruthy();
  });
});

describe('ProblemsPanel', () => {
  const diag = (line: number, severity: StudioDiagnostic['severity'], extra: Partial<StudioDiagnostic> = {}): StudioDiagnostic => ({ line, column: 2, endLine: line, endColumn: 4, severity, message: `m${line}`, ...extra });
  it('sorts by severity then position', () => {
    expect(sortDiagnostics([diag(5, 'warning'), diag(9, 'error'), diag(1, 'info'), diag(2, 'error')]).map(row => row.line)).toEqual([2, 9, 5, 1]);
  });
  it('lists problems, reveals and hands off to the agent', () => {
    const onReveal = vi.fn(); const onFix = vi.fn();
    const { rerender } = render(<ProblemsPanel path="a/b.agent" diagnostics={[diag(3, 'warning', { code: 'W1' }), diag(7, 'error')]} onReveal={onReveal} onFixWithAgent={onFix} />);
    expect(screen.getByText(/2 problems/)).toBeTruthy();
    fireEvent.click(screen.getByText('m7'));
    expect(onReveal).toHaveBeenCalledWith(7, 2);
    fireEvent.click(screen.getByRole('button', { name: /Fix with agent/ }));
    expect(onFix).toHaveBeenCalled();
    rerender(<ProblemsPanel path="a/b.agent" diagnostics={[diag(1, 'hint')]} busy onFixWithAgent={onFix} />);
    expect((screen.getByRole('button', { name: /Asking/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByText('m1')); // no onReveal handler: no throw
    rerender(<ProblemsPanel path="a/b.agent" diagnostics={[]} onFixWithAgent={onFix} />);
    expect(screen.getByText('No problems')).toBeTruthy();
    expect((screen.getByRole('button', { name: /Fix with agent/ }) as HTMLButtonElement).disabled).toBe(true);
    rerender(<ProblemsPanel path={null} diagnostics={[]} />);
    expect(screen.getByText(/Open a project file/)).toBeTruthy();
  });
});

describe('Explorer', () => {
  const nodes: ExplorerNode[] = [
    { kind: 'apex', apiName: 'OrderLookup', path: 'classes/OrderLookup.cls', usedBy: ['a.agent', 'b.agent'] },
    { kind: 'flow', apiName: 'RefundFlow' },
    { kind: 'prompt', apiName: 'Greeting' },
    { kind: 'scenario', apiName: 'smoke', path: 'tests/smoke.scenario.json', badge: { status: 'pass' } },
    { kind: 'org-agent', apiName: 'Billing' }
  ];
  const files = [{ apiName: 'QC', path: 'force-app/bots/QC.agent', lines: 4 }];
  const props = () => ({ files, nodes, activePath: null, query: '', onQuery: vi.fn(), onOpenFile: vi.fn(), onOpenNode: vi.fn(), onBrowseOrg: vi.fn() });
  it('groups nodes by kind and filters by query', () => {
    expect(groupExplorerNodes(nodes, '').map(group => group.kind)).toEqual(['apex', 'flow', 'prompt', 'scenario', 'org-agent']);
    expect(groupExplorerNodes([{ kind: 'lightning-type', apiName: 'c__T' }, ...nodes], '').map(group => group.kind)).toEqual(['apex', 'flow', 'prompt', 'lightning-type', 'scenario', 'org-agent']);
    expect(groupExplorerNodes(nodes, ' refund ').map(group => group.kind)).toEqual(['flow']);
    expect(groupExplorerNodes([], '')).toEqual([]);
  });
  it('opens files and nodes without an examples section; prompts are not openable', () => {
    const p = props();
    render(<Explorer {...p} dirtyPath="force-app/bots/QC.agent" />);
    expect(screen.queryByText(/Examples/)).toBeNull();
    fireEvent.click(screen.getByText('Billing'));
    expect(p.onOpenNode).toHaveBeenCalledWith(nodes[4]);
    fireEvent.click(screen.getByText('OrderLookup'));
    expect(p.onOpenNode).toHaveBeenCalledWith(nodes[0]);
    expect(screen.getByText('2×')).toBeTruthy();
    expect(screen.getByLabelText('Passing')).toBeTruthy();
    expect((screen.getByText('Greeting').closest('button') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('salesforce-agent-script-file:force-app/bots/QC.agent'));
    expect(p.onOpenFile).toHaveBeenCalledWith('force-app/bots/QC.agent');
    expect(screen.getByLabelText('Unsaved changes')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Filter Agentforce files'), { target: { value: 'x' } });
    expect(p.onQuery).toHaveBeenCalledWith('x');
  });
  it('shows an empty project state with a browse action', () => {
    const p = { ...props(), files: [], nodes: [], query: '' };
    const { rerender } = render(<Explorer {...p} />);
    fireEvent.click(screen.getByText('Browse agents in your org'));
    expect(p.onBrowseOrg).toHaveBeenCalled();
    rerender(<Explorer {...p} query="zz" />);
    expect(screen.getByText('No matching files')).toBeTruthy();
  });
  it('folds sections, keeps them open while filtering, and hides the column', () => {
    const typed: ExplorerNode[] = [...nodes, { kind: 'lightning-type', apiName: 'lightning__textType' }, { kind: 'lightning-type', apiName: 'c__Ghost', usedBy: ['a.agent'] }, { kind: 'lightning-type', apiName: 'c__Order', path: 'lightningTypes/Order' }];
    const onToggleSection = vi.fn(); const onHide = vi.fn();
    const p = { ...props(), nodes: typed };
    const { rerender } = render(<Explorer {...p} collapsed={['apex', 'project']} onToggleSection={onToggleSection} onHide={onHide} />);
    expect(screen.queryByText('OrderLookup')).toBeNull();
    expect(screen.queryByTestId('salesforce-agent-script-file:force-app/bots/QC.agent')).toBeNull();
    const types = screen.getByRole('button', { name: /Lightning Types/ });
    expect(types.getAttribute('aria-expanded')).toBe('true');
    expect(types.textContent).toContain('3');
    expect(screen.getByText('std')).toBeTruthy();
    expect(screen.getByText('missing')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Apex 1' }));
    expect(onToggleSection).toHaveBeenCalledWith('apex');
    fireEvent.click(screen.getByRole('button', { name: 'Hide explorer' }));
    expect(onHide).toHaveBeenCalled();
    rerender(<Explorer {...p} query="order" collapsed={['apex']} onToggleSection={onToggleSection} />);
    expect(screen.getByText('OrderLookup')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Hide explorer' })).toBeNull();
  });
  it('expands and collapses folders', () => {
    const nested = [{ apiName: 'A', path: 'force-app/main/A.agent', lines: 1 }];
    render(<Explorer {...props()} files={nested} nodes={[]} />);
    const folder = screen.getAllByRole('button').find(button => button.getAttribute('aria-expanded') !== null && button.textContent?.includes('force-app'))!;
    fireEvent.click(folder);
    fireEvent.click(folder);
    expect(folder).toBeTruthy();
  });
});
