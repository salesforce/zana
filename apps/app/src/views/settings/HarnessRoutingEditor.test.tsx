// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HarnessAdapterDescriptor } from '@zana-ai/zcc-domain/harness-adapter';
import { HarnessRoutingEditor, applyHarnessRoutingPatch } from './HarnessRoutingEditor.js';

const descriptor = (id: string, label: string, extra: object = {}): HarnessAdapterDescriptor => ({
  id, label, agentDefaultEligible: true, terminalEligible: false,
  defaultProfileId: id,
  profiles: [], availability: { enabled: true, installed: true },
  capabilities: {},
  settingsContributionIds: [],
  configFiles: [],
  targets: {
    roles: [],
    models: [{ id: 'm1', label: 'Model One', level: 'medium', scope: ['local'] }],
    modelLevelMapping: { low: 'm1', medium: 'm1', high: 'm1', 'extra-high': 'm1' },
    executionStateMapping: { 'accept-edits': 'acceptEdits' },
    ...extra
  },
  initialTaskDelivery: { local: 'spawn-arg', remote: 'spawn-arg', readinessSignal: 'process-spawned', acceptanceSignal: 'argv-bound' }
} as unknown as HarnessAdapterDescriptor);

afterEach(cleanup);

describe('applyHarnessRoutingPatch', () => {
  it('merges, clears undefined keys, and prunes empty adapters', () => {
    const one = applyHarnessRoutingPatch(undefined, 'claude', { modelTargetId: 'm1' });
    expect(one).toEqual({ schemaVersion: 1, byAdapter: { claude: { modelTargetId: 'm1' } } });
    const two = applyHarnessRoutingPatch(one, 'claude', { executionState: 'plan' });
    expect(two?.byAdapter.claude).toEqual({ modelTargetId: 'm1', executionState: 'plan' });
    const three = applyHarnessRoutingPatch(two, 'claude', { modelTargetId: undefined, executionState: undefined });
    expect(three).toBeUndefined();
  });
});

describe('HarnessRoutingEditor', () => {
  const descriptors = [descriptor('claude', 'Claude Code'), descriptor('codex', 'Codex')];

  it('lists rows and default-harness options alphabetically by label', () => {
    render(
      <HarnessRoutingEditor
        descriptors={[descriptor('pi', 'Pi'), descriptor('codex', 'Codex'), descriptor('claude', 'Claude Code')]}
        value={undefined}
        onChange={vi.fn()}
        inheritLabel="Inherit"
        defaultHarness={{ value: '', onChange: vi.fn() }}
      />
    );
    const rows = screen.getAllByLabelText(/^Project settings for /).map((row) => row.getAttribute('aria-label'));
    expect(rows).toEqual(['Project settings for Claude Code', 'Project settings for Codex', 'Project settings for Pi']);
    fireEvent.click(screen.getByRole('button', { name: /Default harness/ }));
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['Inherit', 'Claude Code', 'Codex', 'Pi']);
  });

  it('picks a default harness and uses the inherit label', () => {
    const onPick = vi.fn();
    render(
      <HarnessRoutingEditor
        descriptors={descriptors}
        value={undefined}
        onChange={vi.fn()}
        inheritLabel="Use project default"
        defaultHarness={{ value: '', onChange: onPick }}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /Default harness/ }));
    expect(screen.getAllByText('Use project default').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('option', { name: 'Codex' }));
    expect(onPick).toHaveBeenCalledWith('codex');
  });

  it('edits a per-family row', () => {
    const onChange = vi.fn();
    render(<HarnessRoutingEditor descriptors={descriptors} value={undefined} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Project settings for Claude Code'));
    expect(screen.queryByRole('tablist')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Default model level/ }));
    fireEvent.click(screen.getByRole('option', { name: 'Model One [Medium]' }));
    expect(onChange).toHaveBeenCalledWith('claude', { modelTargetId: 'm1' });
  });

  it('shows tabs, extras, and tab content from host renderers', () => {
    render(
      <HarnessRoutingEditor
        descriptors={[descriptor('pi', 'Pi', { models: [], executionStateMapping: undefined })]}
        value={undefined}
        onChange={vi.fn()}
        renderLaunchExtras={() => <div>pi-extras</div>}
        renderTab={(tab) => <div>tab-{tab}</div>}
      />
    );
    fireEvent.click(screen.getByLabelText('Project settings for Pi'));
    expect(screen.getByText('pi-extras')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Harness Files' }));
    expect(screen.getByText('tab-files')).toBeTruthy();
  });

  it('shows empty-state help and hides rows while loading', () => {
    const { rerender } = render(
      <HarnessRoutingEditor descriptors={[descriptor('pi', 'Pi', { models: [], executionStateMapping: undefined })]} value={undefined} onChange={vi.fn()} />
    );
    fireEvent.click(screen.getByLabelText('Project settings for Pi'));
    expect(screen.getByText('No project-specific settings are available for this harness.')).toBeTruthy();
    rerender(<HarnessRoutingEditor descriptors={descriptors} value={undefined} onChange={vi.fn()} loading />);
    expect(screen.queryByLabelText('Project settings for Claude Code')).toBeNull();
  });

  it('names rows with the caller’s copy', () => {
    render(
      <HarnessRoutingEditor
        descriptors={[descriptor('pi', 'Pi', { models: [], executionStateMapping: undefined })]}
        value={undefined}
        onChange={vi.fn()}
        rowCopy={{ expandLabel: (label) => `Agent settings for ${label}`, blurb: 'Agent launch settings', empty: 'Nothing to set.' }}
      />
    );
    expect(screen.getByText('Agent launch settings')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Agent settings for Pi'));
    expect(screen.getByText('Nothing to set.')).toBeTruthy();
  });
});
