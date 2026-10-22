/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExplorerNode, StudioDiagnostic } from '../../../lib/studio-contract.js';
import { BottomPanel } from './BottomPanel.js';
import { EditorTabs, tabsToClose } from './EditorTabs.js';
import { Explorer, buildAgentOutline, filterOutline, groupExplorerNodes, type OutlineUse } from './Explorer.js';
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
  it('marks the combined tests workbench separately from org browsers', () => {
    render(<EditorTabs tabs={[
      { id: 'org-tests', kind: 'org', target: 'tests', label: 'Tests' },
      { id: 'org-agents', kind: 'org', target: 'agents', label: 'Agents' }
    ]} active="org-tests" onSelect={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole('tab', { name: 'TESTS Tests' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'ORG Agents' })).toBeTruthy();
  });
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
    fireEvent.keyDown(screen.getByRole('tab', { name: /Script/ }), { key: 'ArrowLeft' });
    expect(onSelect).toHaveBeenLastCalledWith('type:c__Order');
    fireEvent.keyDown(screen.getByRole('tab', { name: /Script/ }), { key: 'ArrowRight' });
    expect(onSelect).toHaveBeenLastCalledWith('apex:Lookup');
    onSelect.mockClear();
    fireEvent.keyDown(screen.getByRole('tab', { name: /Script/ }), { key: 'q' });
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Close Refund' }));
    expect(onClose).toHaveBeenCalledWith('flow:Refund');
  });
  it('names the Script tab by its label, keeps it closeable only with its agent, and shows view tabs without a kind mark', () => {
    const onClose = vi.fn();
    render(<EditorTabs tabs={[
      { id: 'agent:a', kind: 'agent', label: 'A.agent', path: 'a.agent' },
      { id: 'view:preview', kind: 'view', label: 'Preview', target: 'preview' },
      { id: 'view:tests', kind: 'view', label: 'Tests', target: 'tests' }
    ]} active="view:preview" onSelect={vi.fn()} onClose={onClose} />);
    expect(screen.getByRole('tab', { name: 'Script' }).getAttribute('title')).toBe('a.agent');
    expect(screen.queryByRole('button', { name: /Close A\.agent|Close Script/ })).toBeNull();
    expect(screen.getByRole('tab', { name: 'Preview' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByText('read-only')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close Tests' }));
    expect(onClose).toHaveBeenCalledWith('view:tests');
  });
  it('lists the tabs each close command removes', () => {
    expect(tabsToClose(tabs, 'apex:Lookup', 'close')).toEqual(['apex:Lookup']);
    expect(tabsToClose(tabs, 'apex:Lookup', 'others')).toEqual(['agent:a', 'flow:Refund', 'type:c__Order']);
    expect(tabsToClose(tabs, 'apex:Lookup', 'right')).toEqual(['flow:Refund', 'type:c__Order']);
    expect(tabsToClose(tabs, 'type:c__Order', 'right')).toEqual([]);
    expect(tabsToClose(tabs, 'apex:Lookup', 'all')).toEqual(tabs.map(tab => tab.id));
    expect(tabsToClose(tabs, 'missing', 'all')).toEqual([]);
  });
  it('closes tabs from a right-click menu', () => {
    const onCloseMany = vi.fn();
    render(<EditorTabs tabs={tabs} active="agent:a" onSelect={vi.fn()} onClose={vi.fn()} onCloseMany={onCloseMany} />);
    const lookup = screen.getByRole('tab', { name: /Lookup/ });
    fireEvent.contextMenu(lookup, { clientX: 40, clientY: 20 });
    const menu = screen.getByRole('menu', { name: 'Lookup tab actions' });
    expect(within(menu).getAllByRole('menuitem').map(item => item.textContent)).toEqual(['Close', 'Close others', 'Close to the right', 'Close all']);
    expect(document.activeElement).toBe(within(menu).getByRole('menuitem', { name: 'Close' }));
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(within(menu).getByRole('menuitem', { name: 'Close others' }));
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(within(menu).getByRole('menuitem', { name: 'Close all' }));
    fireEvent.keyDown(menu, { key: 'Home' });
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Close others' }));
    expect(onCloseMany).toHaveBeenLastCalledWith(['agent:a', 'flow:Refund', 'type:c__Order'], 'apex:Lookup');
    expect(screen.queryByRole('menu')).toBeNull();
    // The last tab has nothing to its right.
    fireEvent.contextMenu(screen.getByRole('tab', { name: /c__Order/ }));
    expect((screen.getByRole('menuitem', { name: 'Close to the right' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Close all' }));
    expect(onCloseMany).toHaveBeenLastCalledWith(tabs.map(tab => tab.id), 'type:c__Order');
  });
  it('opens the tab menu from the keyboard and dismisses it', () => {
    const onCloseMany = vi.fn();
    render(<EditorTabs tabs={tabs} active="agent:a" onSelect={vi.fn()} onClose={vi.fn()} onCloseMany={onCloseMany} />);
    const agent = screen.getByRole('tab', { name: /Script/ });
    fireEvent.keyDown(agent, { key: 'F10', shiftKey: true });
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.keyDown(agent, { key: 'ContextMenu' });
    fireEvent.mouseDown(screen.getByRole('menuitem', { name: 'Close' }));
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.contextMenu(agent);
    fireEvent(window, new Event('blur'));
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.contextMenu(agent);
    fireEvent(window, new Event('resize'));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(onCloseMany).not.toHaveBeenCalled();
  });
  it('keeps the native context menu without a bulk close handler', () => {
    render(<EditorTabs tabs={tabs} active="agent:a" onSelect={vi.fn()} onClose={vi.fn()} />);
    const agent = screen.getByRole('tab', { name: /Script/ });
    expect(fireEvent.contextMenu(agent)).toBe(true);
    fireEvent.keyDown(agent, { key: 'ContextMenu' });
    expect(screen.queryByRole('menu')).toBeNull();
  });
  it('badges only the agent tab that owns the problems and renders trailing workspace controls', () => {
    const { container, rerender } = render(<EditorTabs tabs={tabs} active="flow:Refund" problemsId="agent:a" problems={2} trailing={<button>Go to file</button>} onSelect={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByLabelText('2 problems')).toBeTruthy();
    expect(container.querySelector('.sf-etabs-bar .sf-etabs-actions')?.textContent).toBe('Go to file');
    rerender(<EditorTabs tabs={tabs} active="agent:a" problemsId={null} problems={2} onSelect={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByLabelText('2 problems')).toBeNull();
    expect(container.querySelector('.sf-etabs-bar')).toBeNull();
  });
  it('turns a vertical wheel into sideways scrolling only when the strip overflows, and reveals the active tab', () => {
    const reveal = vi.fn();
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = reveal;
    try {
      const { rerender } = render(<EditorTabs tabs={tabs} active="agent:a" onSelect={vi.fn()} onClose={vi.fn()} />);
      expect(reveal).toHaveBeenCalledTimes(1);
      rerender(<EditorTabs tabs={tabs} active="type:c__Order" onSelect={vi.fn()} onClose={vi.fn()} />);
      expect(reveal).toHaveBeenCalledTimes(2);
      const strip = screen.getByRole('tablist');
      const wheel = (deltaX: number, deltaY: number) => {
        const event = new WheelEvent('wheel', { deltaX, deltaY, cancelable: true, bubbles: true });
        strip.dispatchEvent(event);
        return event.defaultPrevented;
      };
      // Everything fits: the wheel is left to the page.
      expect(wheel(0, 40)).toBe(false);
      Object.defineProperty(strip, 'scrollWidth', { configurable: true, value: 800 });
      Object.defineProperty(strip, 'clientWidth', { configurable: true, value: 300 });
      expect(wheel(0, 40)).toBe(true);
      expect(strip.scrollLeft).toBe(40);
      // A sideways trackpad swipe already scrolls natively.
      expect(wheel(30, 5)).toBe(false);
    } finally {
      HTMLElement.prototype.scrollIntoView = original;
    }
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
  it('lists info and hint entries as notes without counting them as problems', () => {
    const onFix = vi.fn();
    const { rerender } = render(<ProblemsPanel path="a/b.agent" diagnostics={[diag(1, 'info'), diag(2, 'hint')]} onFixWithAgent={onFix} />);
    expect(screen.getByText(/No problems · 2 notes/)).toBeTruthy();
    expect(screen.getByText('m1')).toBeTruthy();
    expect(screen.getByText('m2')).toBeTruthy();
    expect((screen.getByRole('button', { name: /Fix with agent/ }) as HTMLButtonElement).disabled).toBe(true);
    rerender(<ProblemsPanel path="a/b.agent" diagnostics={[diag(1, 'info'), diag(4, 'error')]} onFixWithAgent={onFix} />);
    expect(screen.getByText(/1 problem · 1 note/)).toBeTruthy();
    expect((screen.getByRole('button', { name: /Fix with agent/ }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('Explorer', () => {
  const QC = 'force-app/bots/QC.agent';
  const nodes: ExplorerNode[] = [
    { kind: 'agent', apiName: 'QC', path: QC, uses: [{ kind: 'apex', apiName: 'OrderLookup' }, { kind: 'flow', apiName: 'RefundFlow' }, { kind: 'prompt', apiName: 'Greeting' }, { kind: 'apex', apiName: 'Unresolved' }] },
    { kind: 'apex', apiName: 'OrderLookup', path: 'classes/OrderLookup.cls', usedBy: [QC, 'b.agent'] },
    { kind: 'flow', apiName: 'RefundFlow', usedBy: [QC] },
    { kind: 'prompt', apiName: 'Greeting', usedBy: [QC] },
    { kind: 'scenario', apiName: 'smoke', path: 'tests/smoke.scenario.json', badge: { status: 'pass' } },
    { kind: 'org-agent', apiName: 'Billing' }
  ];
  const files = [{ apiName: 'QC', path: QC, lines: 4 }];
  const props = () => ({ files, nodes, activePath: null as string | null, query: '', onQuery: vi.fn(), onOpenFile: vi.fn(), onOpenNode: vi.fn(), onBrowseOrg: vi.fn() });
  const twisty = (name: string) => screen.getByRole('button', { name: new RegExp(`^(Show|Hide) what ${name} uses$`) });
  it('groups nodes by kind and filters by query', () => {
    expect(groupExplorerNodes(nodes, '').map(group => group.kind)).toEqual(['apex', 'flow', 'prompt', 'scenario', 'org-agent']);
    expect(groupExplorerNodes([{ kind: 'lwc', apiName: 'c/card' }, { kind: 'lightning-type', apiName: 'c__T' }, ...nodes], '').map(group => group.kind)).toEqual(['apex', 'flow', 'prompt', 'lightning-type', 'lwc', 'scenario', 'org-agent']);
    expect(groupExplorerNodes(nodes, ' refund ').map(group => group.kind)).toEqual(['flow']);
    expect(groupExplorerNodes([], '')).toEqual([]);
  });
  it('builds the outline from per-agent uses, splits off .zcc history and tells same-named agents apart', () => {
    const many = [...files, { apiName: 'QC', path: 'agentforce/org/QC.agent', lines: 2 }, { apiName: 'QC', path: '.zcc/agent-versions/QC/QC.agent', lines: 9 }];
    const outline = buildAgentOutline(many, [...nodes, { kind: 'agent', apiName: 'QC', path: 'agentforce/org/QC.agent' }]);
    expect(outline.history.map(file => file.path)).toEqual(['.zcc/agent-versions/QC/QC.agent']);
    expect(outline.agents.map(agent => agent.hint)).toEqual(['force-app', 'agentforce']);
    const uses = outline.agents[0]!.uses as OutlineUse[];
    expect(uses.map(row => [row.use.apiName, row.node?.path])).toEqual([['OrderLookup', 'classes/OrderLookup.cls'], ['RefundFlow', undefined], ['Greeting', undefined], ['Unresolved', undefined]]);
    expect(uses[3]!.node).toBeUndefined();
    // An agent node without `uses` beside agents that have them was past the server's scan limit.
    expect(outline.agents[1]!.uses).toBe('unindexed');
  });
  it('falls back to inverting usedBy when the server sends no per-agent uses', () => {
    const legacy = nodes.filter(node => node.kind !== 'agent');
    expect((buildAgentOutline(files, legacy).agents[0]!.uses as OutlineUse[]).map(row => row.use.apiName)).toEqual(['OrderLookup', 'RefundFlow', 'Greeting']);
    expect(buildAgentOutline([{ apiName: 'Lone', path: 'Lone.agent', lines: 1 }], legacy).agents[0]!.uses).toBeNull();
    expect(buildAgentOutline([{ apiName: 'Lone', path: 'Lone.agent', lines: 1 }], [{ kind: 'agent', apiName: 'Lone', path: 'Lone.agent' }]).agents[0]!.uses).toEqual([]);
  });
  it('filters agents by name, or by a reference name and then shows only the matching references', () => {
    const { agents } = buildAgentOutline(files, nodes);
    expect(filterOutline(agents, '')[0]!.forceOpen).toBe(false);
    expect(filterOutline(agents, 'qc')[0]!.uses).toHaveLength(4);
    const byRef = filterOutline(agents, 'refund');
    expect(byRef[0]!.forceOpen).toBe(true);
    expect((byRef[0]!.uses as OutlineUse[]).map(row => row.use.apiName)).toEqual(['RefundFlow']);
    expect(filterOutline(agents, 'nothing')).toEqual([]);
    expect(filterOutline([{ file: files[0]!, uses: 'unindexed' }], 'refund')).toEqual([]);
  });
  it('focuses the open agent on its grouped references, which open; prompts are not openable', () => {
    const p = { ...props(), activePath: QC };
    const history = { apiName: 'QC', path: '.zcc/agent-versions/QC/QC.agent', lines: 3 };
    const unrelated = { apiName: 'Other', path: '.zcc/agent-versions/Other/Other.agent', lines: 3 };
    render(<Explorer {...p} files={[...files, history, unrelated]} dirtyPath={QC} collapsed={['history']} onToggleSection={vi.fn()} />);
    // No agent list and no org row: only the open agent, its references and its own history.
    expect(screen.queryByRole('button', { name: /Agents in this project/ })).toBeNull();
    expect(screen.queryByTestId('sf-explorer-org-link')).toBeNull();
    expect(screen.getByTestId('sf-explorer-all-agents').textContent).toBe('All agents1');
    expect((screen.getByLabelText('Filter Agentforce files') as HTMLInputElement).placeholder).toBe('Filter QC');
    expect(['Apex 2', 'Flows 1', 'Prompts 1'].map(name => screen.getByRole('button', { name }).getAttribute('aria-expanded'))).toEqual(['true', 'true', 'true']);
    fireEvent.click(screen.getByText('OrderLookup'));
    expect(p.onOpenNode).toHaveBeenCalledWith(nodes[1]);
    // A reference the explorer could not resolve still opens by name.
    fireEvent.click(screen.getByText('Unresolved'));
    expect(p.onOpenNode).toHaveBeenCalledWith({ kind: 'apex', apiName: 'Unresolved' });
    expect((screen.getByText('Greeting').closest('button') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByLabelText('Used by 2 agents')).toBeTruthy();
    const row = screen.getByTestId(`salesforce-agent-script-file:${QC}`);
    expect(row.getAttribute('aria-current')).toBe('true');
    expect(screen.getByLabelText('Unsaved changes')).toBeTruthy();
    fireEvent.click(row);
    expect(p.onOpenFile).toHaveBeenCalledWith(QC);
    fireEvent.click(screen.getByRole('button', { name: 'Local history 1' }));
    fireEvent.click(screen.getByTestId(`salesforce-agent-script-file:${history.path}`));
    expect(p.onOpenFile).toHaveBeenCalledWith(history.path);
    expect(screen.queryByTestId(`salesforce-agent-script-file:${unrelated.path}`)).toBeNull();
    // "All agents" brings back the outline, with the open agent unfolded; choosing it again focuses it.
    fireEvent.click(screen.getByTestId('sf-explorer-all-agents'));
    expect(twisty('QC').getAttribute('aria-expanded')).toBe('true');
    const deps = screen.getByRole('group', { name: 'QC references' });
    expect([...deps.querySelectorAll('.sf-as-dep-label')].map(label => label.textContent)).toEqual(['Apex2', 'Flows1', 'Prompts1']);
    fireEvent.click(twisty('QC'));
    expect(screen.queryByRole('group', { name: 'QC references' })).toBeNull();
    fireEvent.click(twisty('QC'));
    expect(screen.getByRole('group', { name: 'QC references' })).toBeTruthy();
    expect(screen.queryByText('Billing')).toBeNull();
    fireEvent.click(screen.getByTestId('sf-explorer-org-link'));
    expect(p.onBrowseOrg).toHaveBeenCalled();
    expect(screen.getByLabelText('Passing')).toBeTruthy();
    fireEvent.click(screen.getByTestId(`salesforce-agent-script-file:${QC}`));
    expect(screen.getByTestId('sf-explorer-all-agents')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Filter Agentforce files'), { target: { value: 'x' } });
    expect(p.onQuery).toHaveBeenCalledWith('x');
  });
  it('counts org agents not already on disk in one row that opens the Agents panel', () => {
    const org: ExplorerNode[] = [{ kind: 'org-agent', apiName: 'QC' }, { kind: 'org-agent', apiName: 'Billing' }, { kind: 'org-agent', apiName: 'Bot' }];
    const p = props();
    const { rerender } = render(<Explorer {...p} nodes={org} orgLabel="dev-sandbox" orgAgentsMore />);
    const link = screen.getByTestId('sf-explorer-org-link');
    expect(link.textContent).toContain('2+ more in the org');
    expect(link.textContent).toContain('dev-sandbox');
    // A filter counts only the matching org agents, and that count is exact ("bots" in QC's path keeps it listed).
    rerender(<Explorer {...p} nodes={org} query="b" orgAgentsMore />);
    expect(screen.getByTestId('sf-explorer-org-link').textContent).toContain('2 more in the org');
    // The server's exact count replaces the capped list's floor, but not under a filter.
    rerender(<Explorer {...p} nodes={org} orgAgentsMore orgAgentsNotLocal={1237} />);
    expect(screen.getByTestId('sf-explorer-org-link').textContent).toContain('1,237 more in the org');
    rerender(<Explorer {...p} nodes={org} query="b" orgAgentsMore orgAgentsNotLocal={1237} />);
    expect(screen.getByTestId('sf-explorer-org-link').textContent).toContain('2 more in the org');
    rerender(<Explorer {...p} nodes={org} query="qc" orgAgentsMore />);
    expect(screen.queryByTestId('sf-explorer-org-link')).toBeNull();
    // Every org agent already on disk, or nothing on disk (the empty state has its own browse action): no row.
    rerender(<Explorer {...p} nodes={[org[0]!]} />);
    expect(screen.queryByTestId('sf-explorer-org-link')).toBeNull();
    rerender(<Explorer {...p} files={[]} nodes={org} />);
    expect(screen.queryByTestId('sf-explorer-org-link')).toBeNull();
    expect(screen.getByText('Browse agents in your org')).toBeTruthy();
  });
  it('focuses an agent once it becomes active and explains missing, empty, unindexed or unmatched references', () => {
    const p = props();
    const other = { apiName: 'Other', path: 'Other.agent', lines: 1 };
    const quiet = { apiName: 'Quiet', path: 'Quiet.agent', lines: 1 };
    const withMore: ExplorerNode[] = [...nodes, { kind: 'agent', apiName: 'Other', path: 'Other.agent' }, { kind: 'agent', apiName: 'Quiet', path: 'Quiet.agent', uses: [] }];
    const all = [...files, other, quiet];
    const { rerender } = render(<Explorer {...p} files={all} nodes={withMore} />);
    expect(twisty('QC').getAttribute('aria-expanded')).toBe('false');
    rerender(<Explorer {...p} files={all} nodes={withMore} activePath="Other.agent" />);
    expect(screen.getByText('References not indexed for this agent.')).toBeTruthy();
    rerender(<Explorer {...p} files={all} nodes={withMore} activePath="Quiet.agent" />);
    expect(screen.getByText('No Apex, Flow, prompt or type references.')).toBeTruthy();
    // Before the explorer has answered, nothing is known about the open agent yet.
    rerender(<Explorer {...p} files={all} nodes={[]} activePath="Quiet.agent" />);
    expect(screen.getByText('Finding references…')).toBeTruthy();
    // Widened for Quiet, then another agent opens: the explorer focuses again.
    rerender(<Explorer {...p} files={all} nodes={withMore} activePath="Quiet.agent" />);
    fireEvent.click(screen.getByTestId('sf-explorer-all-agents'));
    expect(screen.queryByTestId('sf-explorer-all-agents')).toBeNull();
    rerender(<Explorer {...p} files={all} nodes={withMore} activePath={QC} />);
    expect(screen.getByTestId('sf-explorer-all-agents')).toBeTruthy();
    rerender(<Explorer {...p} files={all} nodes={withMore} activePath={QC} query="refund" />);
    expect(screen.getByText('RefundFlow')).toBeTruthy();
    expect(screen.queryByText('OrderLookup')).toBeNull();
    rerender(<Explorer {...p} files={all} nodes={withMore} activePath={QC} query="nothing" />);
    expect(screen.getByText('No matching references.')).toBeTruthy();
    // The filter that found the agent names it, so it keeps every reference once the agent opens.
    rerender(<Explorer {...p} files={all} nodes={withMore} activePath={QC} query="qc" />);
    expect(screen.getByText('RefundFlow')).toBeTruthy();
    expect(screen.getByText('OrderLookup')).toBeTruthy();
    expect(screen.queryByText('No matching references.')).toBeNull();
    // A local-history file is not a project agent, so it keeps the full outline.
    rerender(<Explorer {...p} files={[...all, { apiName: 'QC', path: '.zcc/v/QC.agent', lines: 1 }]} nodes={withMore} activePath=".zcc/v/QC.agent" />);
    expect(screen.queryByTestId('sf-explorer-all-agents')).toBeNull();
  });
  it('lists an unscanned agent on demand when it is unfolded', () => {
    const p = { ...props(), onIndexAgent: vi.fn() };
    // `Late` has no node at all: past the server's agent limit, beside agents that were scanned.
    const late = { apiName: 'Late', path: 'Late.agent', lines: 1 };
    expect(buildAgentOutline([...files, late], nodes).agents[1]!.uses).toBe('unindexed');
    const { rerender } = render(<Explorer {...p} files={[...files, late]} />);
    fireEvent.click(twisty('Late'));
    expect(p.onIndexAgent).toHaveBeenCalledWith('Late.agent');
    expect(screen.getByText('References not indexed for this agent.')).toBeTruthy();
    rerender(<Explorer {...p} files={[...files, late]} indexing={['Late.agent']} />);
    expect(screen.getByText('Finding references…')).toBeTruthy();
    // Folding asks nothing; an indexed agent unfolds without asking.
    fireEvent.click(twisty('Late'));
    fireEvent.click(twisty('QC'));
    expect(p.onIndexAgent).toHaveBeenCalledTimes(1);
    rerender(<Explorer {...p} files={[...files, late]} nodes={[...nodes, { kind: 'agent', apiName: 'Late', path: 'Late.agent', uses: [{ kind: 'apex', apiName: 'OrderLookup' }] }]} />);
    fireEvent.click(twisty('Late'));
    expect(screen.getByRole('group', { name: 'Late references' }).textContent).toContain('OrderLookup');
    expect(p.onIndexAgent).toHaveBeenCalledTimes(1);
  });
  it('lists local history apart, folded by default, and opens its files', () => {
    const p = props();
    const history = { apiName: 'QC', path: '.zcc/agent-versions/QC/QC.agent', lines: 3 };
    const onToggleSection = vi.fn();
    const { rerender } = render(<Explorer {...p} files={[...files, history]} onToggleSection={onToggleSection} />);
    const toggle = screen.getByRole('button', { name: 'Local history 1' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(onToggleSection).toHaveBeenCalledWith('history');
    rerender(<Explorer {...p} files={[...files, history]} collapsed={['history']} onToggleSection={onToggleSection} activePath={history.path} dirtyPath={history.path} />);
    fireEvent.click(screen.getByTestId(`salesforce-agent-script-file:${history.path}`));
    expect(p.onOpenFile).toHaveBeenCalledWith(history.path);
    expect(screen.getByText('agent-versions')).toBeTruthy();
    // A filter shows matching history even though the section is folded by default.
    rerender(<Explorer {...p} files={[...files, history]} query="versions" />);
    expect(screen.getByTestId(`salesforce-agent-script-file:${history.path}`)).toBeTruthy();
    rerender(<Explorer {...p} files={[...files, history]} query="nomatch" />);
    expect(screen.queryByRole('button', { name: /Local history/ })).toBeNull();
  });
  it('shows an empty project state with a browse action', () => {
    const p = { ...props(), files: [], nodes: [], query: '' };
    const { rerender } = render(<Explorer {...p} />);
    fireEvent.click(screen.getByText('Browse agents in your org'));
    expect(p.onBrowseOrg).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /All references/ })).toBeNull();
    rerender(<Explorer {...p} query="zz" />);
    expect(screen.getByText('No matching files')).toBeTruthy();
  });
  it('swaps to the reference catalogue and back, with usage counts and type markers', () => {
    const typed: ExplorerNode[] = [...nodes, { kind: 'lightning-type', apiName: 'lightning__textType' }, { kind: 'lightning-type', apiName: 'c__Ghost', usedBy: ['a.agent'] }, { kind: 'lightning-type', apiName: 'c__Order', path: 'lightningTypes/Order' }];
    const onToggleSection = vi.fn();
    const p = { ...props(), nodes: typed };
    const { rerender } = render(<Explorer {...p} collapsed={['apex']} onToggleSection={onToggleSection} />);
    const all = screen.getByRole('button', { name: /All references/ });
    expect(all.textContent).toContain('6');
    fireEvent.click(all);
    expect(all.getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByTestId(`salesforce-agent-script-file:${QC}`)).toBeNull();
    expect(screen.queryByText('OrderLookup')).toBeNull();
    const types = screen.getByRole('button', { name: /Lightning Types/ });
    expect(types.getAttribute('aria-expanded')).toBe('true');
    expect(types.textContent).toContain('3');
    expect(screen.getByText('std')).toBeTruthy();
    expect(screen.getByText('missing')).toBeTruthy();
    expect(screen.getAllByLabelText('Used by 1 agent').map(el => el.textContent)).toEqual(['1', '1', '1']);
    fireEvent.click(screen.getByRole('button', { name: 'Apex 1' }));
    expect(onToggleSection).toHaveBeenCalledWith('apex');
    rerender(<Explorer {...p} collapsed={[]} onToggleSection={onToggleSection} />);
    expect(screen.getByLabelText('Used by 2 agents').textContent).toBe('2');
    rerender(<Explorer {...p} query="zzz" />);
    expect(screen.getByText('No matching references.')).toBeTruthy();
    rerender(<Explorer {...p} nodes={[...typed, { kind: 'lwc', apiName: 'c/orderCard', path: 'lwc/orderCard', usedBy: [QC], via: ['c__Order'] }, { kind: 'lwc', apiName: 'acme/chip', usedBy: [QC] }]} query="" collapsed={[]} onToggleSection={onToggleSection} />);
    const components = screen.getByRole('button', { name: /Components/ });
    expect(components.textContent).toContain('2');
    expect(screen.getAllByText('missing')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: /c\/orderCard/ }));
    expect(p.onOpenNode).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'lwc', apiName: 'c/orderCard' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back to agents' }));
    expect(screen.getByRole('button', { name: /All references/ }).getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: /All references/ }));
    fireEvent.click(screen.getByRole('button', { name: /All references/ }));
    expect(screen.getByText('Agents in this project')).toBeTruthy();
  });
  it('folds sections, keeps them open while filtering, and hides the column', () => {
    const onToggleSection = vi.fn(); const onHide = vi.fn();
    const p = props();
    const { rerender } = render(<Explorer {...p} collapsed={['project']} onToggleSection={onToggleSection} onHide={onHide} />);
    expect(screen.queryByTestId(`salesforce-agent-script-file:${QC}`)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Agents in this project 1' }));
    expect(onToggleSection).toHaveBeenCalledWith('project');
    fireEvent.click(screen.getByRole('button', { name: 'Hide explorer' }));
    expect(onHide).toHaveBeenCalled();
    rerender(<Explorer {...p} query="order" collapsed={['project']} onToggleSection={onToggleSection} />);
    expect(screen.getByText('OrderLookup')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Hide explorer' })).toBeNull();
  });
});
