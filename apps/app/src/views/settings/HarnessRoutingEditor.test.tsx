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

  it('collapses an open row when toggled twice', () => {
    render(<HarnessRoutingEditor descriptors={descriptors} value={undefined} onChange={vi.fn()} />);
    const expand = screen.getByLabelText('Project settings for Claude Code');
    fireEvent.click(expand);
    expect(expand.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(expand);
    expect(expand.getAttribute('aria-expanded')).toBe('false');
  });

  it('marks disabled non-claude rows off and titles unavailable pickers', () => {
    const off = {
      ...descriptor('opencode', 'OpenCode'),
      availability: { enabled: false, installed: true, reason: 'Not signed in' }
    } as unknown as HarnessAdapterDescriptor;
    const offNoReason = {
      ...descriptor('pi', 'Pi'),
      availability: { enabled: false, installed: false }
    } as unknown as HarnessAdapterDescriptor;
    const { container } = render(<HarnessRoutingEditor descriptors={[off, offNoReason]} value={undefined} onChange={vi.fn()} />);
    expect(container.querySelectorAll('.opener-row--off').length).toBe(2);
    fireEvent.click(screen.getByLabelText('Project settings for OpenCode'));
    expect(screen.getByRole('button', { name: /Default model level/ }).getAttribute('title')).toBe('Not signed in');
    expect(screen.getByRole('button', { name: /Default execution state/ }).getAttribute('title')).toBe('Not signed in');
    fireEvent.click(screen.getByLabelText('Project settings for Pi'));
    expect(screen.getAllByRole('button', { name: /Default model level/ })[1].getAttribute('title')).toBe('Harness unavailable');
  });

  it('picks execution state and clears it with inherit', () => {
    const onChange = vi.fn();
    render(<HarnessRoutingEditor descriptors={descriptors} value={{ schemaVersion: 1, byAdapter: { claude: { executionState: 'accept-edits' } } }} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Project settings for Claude Code'));
    fireEvent.click(screen.getByRole('button', { name: /Default execution state/ }));
    fireEvent.click(screen.getByRole('option', { name: 'Use global default' }));
    expect(onChange).toHaveBeenCalledWith('claude', { executionState: undefined });
    fireEvent.click(screen.getByRole('button', { name: /Default execution state/ }));
    fireEvent.click(screen.getByRole('option', { name: 'acceptEdits [Accept Edits]' }));
    expect(onChange).toHaveBeenCalledWith('claude', { executionState: 'accept-edits' });
  });

  it('clears the model with inherit', () => {
    const onChange = vi.fn();
    render(<HarnessRoutingEditor descriptors={descriptors} value={{ schemaVersion: 1, byAdapter: { claude: { modelTargetId: 'm1' } } }} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Project settings for Claude Code'));
    fireEvent.click(screen.getByRole('button', { name: /Default model level/ }));
    fireEvent.click(screen.getByRole('option', { name: 'Use global default' }));
    expect(onChange).toHaveBeenCalledWith('claude', { modelTargetId: undefined });
  });

  describe('provider picklist', () => {
    const providers = [{ id: 'p1', label: 'Provider One' }, { id: 'p2', label: 'Provider Two' }];
    const models = [
      { id: 'a', label: 'Alpha', provider: 'p1', scope: ['local'] },
      { id: 'b', label: 'Beta', provider: 'p2', level: 'extra-high', scope: ['local'] },
      { id: 'c', label: 'Gamma', scope: ['local'] }
    ];
    const open = (value: unknown, extra: object = {}, onChange = vi.fn()) => {
      render(
        <HarnessRoutingEditor
          descriptors={[descriptor('opencode', 'OpenCode', { providers, models, ...extra })]}
          value={value as never}
          onChange={onChange}
        />
      );
      fireEvent.click(screen.getByLabelText('Project settings for OpenCode'));
      return onChange;
    };
    const pickProvider = (name: string) => {
      fireEvent.click(screen.getByRole('button', { name: /Default provider/ }));
      fireEvent.click(screen.getByRole('option', { name }));
    };

    it('clears the model when choosing a different provider', () => {
      const onChange = open({ schemaVersion: 1, byAdapter: { opencode: { modelTargetId: 'a' } } });
      pickProvider('Provider Two');
      expect(onChange).toHaveBeenCalledWith('opencode', { providerTargetId: 'p2', modelTargetId: undefined });
    });

    it('keeps the model when choosing the same provider', () => {
      const onChange = open({ schemaVersion: 1, byAdapter: { opencode: { modelTargetId: 'a' } } });
      pickProvider('Provider One');
      expect(onChange).toHaveBeenCalledWith('opencode', { providerTargetId: 'p1' });
    });

    it('keeps the model-less selection and clears on inherit', () => {
      const onChange = open({ schemaVersion: 1, byAdapter: { opencode: { providerTargetId: 'p1' } } });
      pickProvider('Provider Two');
      expect(onChange).toHaveBeenCalledWith('opencode', { providerTargetId: 'p2' });
      pickProvider('Use global default');
      expect(onChange).toHaveBeenCalledWith('opencode', { providerTargetId: undefined, modelTargetId: undefined });
    });

    it('filters models by the routed provider and labels levels', () => {
      open({ schemaVersion: 1, byAdapter: { opencode: { providerTargetId: 'p2' } } });
      fireEvent.click(screen.getByRole('button', { name: /Default model level/ }));
      const labels = screen.getAllByRole('option').map((option) => option.textContent);
      expect(labels).toEqual(['Use global default', 'Beta [Extra High]', 'Gamma']);
    });

    it('shows all models with no provider routed', () => {
      open(undefined);
      fireEvent.click(screen.getByRole('button', { name: /Default model level/ }));
      expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
        'Use global default', 'Alpha', 'Beta [Extra High]', 'Gamma'
      ]);
    });

    it('shows a fixed provider without an inherit option', () => {
      open(undefined, { providers: [{ id: 'p1', label: 'Provider One' }], providerModelRelationship: 'fixed-provider' });
      expect(screen.getByText('OpenCode uses this fixed provider.')).toBeTruthy();
      const button = screen.getByRole('button', { name: /Default provider/ });
      expect(button.textContent).toContain('Provider One');
    });

    it('derives the shown provider from the routed model', () => {
      open({ schemaVersion: 1, byAdapter: { opencode: { modelTargetId: 'b' } } });
      expect(screen.getByRole('button', { name: /Default provider/ }).textContent).toContain('Provider Two');
    });
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
