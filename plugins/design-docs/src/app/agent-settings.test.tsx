// @vitest-environment happy-dom
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ProjectTab } from './slots.js';
import { createHarness } from './test-harness.js';

const USER = { kind: 'user' as const, label: 'You', threadId: null };

/** Records the props Core's editor receives and lets a test drive `onChange`. */
function installEditorProbe(): { props: () => any } {
  let latest: any = null;
  const runtime = (globalThis as { __ZCC_PLUGIN_RUNTIME__?: Record<string, unknown> }).__ZCC_PLUGIN_RUNTIME__!;
  runtime.experimental_HarnessRoutingEditor = (props: any) => {
    latest = props;
    return (
      <div data-testid="harness-editor" data-loading={String(!!props.loading)} data-inherit={props.inheritLabel}>
        <span data-testid="harness-editor-value">{JSON.stringify(props.value ?? null)}</span>
        {props.notice}
        <button type="button" onClick={() => props.onChange('claude', { modelTargetId: 'sonnet' })}>choose sonnet</button>
        <button type="button" onClick={() => props.onChange('claude', { modelTargetId: undefined })}>clear model</button>
        <span data-testid="harness-editor-choice">{props.defaultHarness?.value}</span>
        <button type="button" onClick={() => props.defaultHarness?.onChange('codex')}>run on codex</button>
        <button type="button" onClick={() => props.defaultHarness?.onChange('')}>follow project harness</button>
      </div>
    );
  };
  return { props: () => latest };
}

async function openAgentSettings(harness: ReturnType<typeof createHarness>) {
  harness.render(<ProjectTab pluginId="design-docs" projectId="p1" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));
  fireEvent.click(screen.getByRole('button', { name: 'Agent' }));
}

describe('Design Docs settings: Agent section', () => {
  it('renders the host harness editor with no inherit-only restriction', async () => {
    const harness = createHarness();
    const probe = installEditorProbe();
    await openAgentSettings(harness);
    expect(screen.getByRole('button', { name: 'Agent' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('button', { name: 'Peers' }).getAttribute('aria-current')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Database sync peers' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Agent harness' })).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('harness-editor').getAttribute('data-loading')).toBe('false'));
    expect(probe.props().descriptors.map((entry: { id: string }) => entry.id)).toEqual(['claude']);
    expect(screen.getByRole('tab', { name: 'Default' }).getAttribute('aria-selected')).toBe('true');
    // Two scopes only: Default (stored at Global) and Project; the host's Default Project scope is not offered.
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Default', 'Project']);
    expect(probe.props().inheritLabel).toBe('Use Zana’s AI harness settings');
    // The section choice is remembered for the next visit.
    expect(localStorage.getItem('zcc.design-docs.settings-tab')).toBe(JSON.stringify('agent'));
  });

  it('saves a choice at Global without any confirmation prompt', async () => {
    const harness = createHarness();
    installEditorProbe();
    await openAgentSettings(harness);
    await waitFor(() => expect(screen.getByTestId('harness-editor').getAttribute('data-loading')).toBe('false'));
    fireEvent.click(screen.getByRole('button', { name: 'choose sonnet' }));
    const expected = { schemaVersion: 1, byAdapter: { claude: { modelTargetId: 'sonnet' } } };
    await waitFor(() => expect(screen.getByTestId('harness-editor-value').textContent).toBe(JSON.stringify(expected)));
    expect(harness.harnessStore.get(JSON.stringify({ kind: 'global' }))).toEqual(expected);
    expect(harness.rpcCalls.map((call) => call.method)).toContain('setHarnessRouting');
    expect(harness.toasts).toEqual([]);
  });

  it('clearing the last field stores nothing, so the scope inherits again', async () => {
    const harness = createHarness();
    const projectKey = JSON.stringify({ kind: 'project', projectId: 'p1' });
    harness.harnessStore.set(projectKey, {
      schemaVersion: 1, byAdapter: { claude: { modelTargetId: 'sonnet' } }
    });
    const probe = installEditorProbe();
    await openAgentSettings(harness);
    fireEvent.click(screen.getByRole('tab', { name: 'Project' }));
    await waitFor(() => expect(screen.getByTestId('harness-editor-value').textContent).toContain('sonnet'));
    expect(probe.props().inheritLabel).toBe('Use Default');
    fireEvent.click(screen.getByRole('button', { name: 'clear model' }));
    await waitFor(() => expect(screen.getByTestId('harness-editor-value').textContent).toBe('null'));
    expect(harness.harnessStore.has(projectKey)).toBe(false);
  });

  it('edits one Project and keeps each scope separate', async () => {
    const harness = createHarness();
    installEditorProbe();
    await openAgentSettings(harness);
    fireEvent.click(screen.getByRole('tab', { name: 'Project' }));
    const select = await screen.findByRole('combobox', { name: 'Project' });
    await waitFor(() => expect(screen.getByTestId('harness-editor').getAttribute('data-loading')).toBe('false'));
    fireEvent.click(screen.getByRole('button', { name: 'choose sonnet' }));
    await waitFor(() => expect(harness.harnessStore.size).toBe(1));
    const [storedKey] = [...harness.harnessStore.keys()];
    expect(JSON.parse(storedKey!)).toEqual({ kind: 'project', projectId: (select as HTMLSelectElement).value });
    fireEvent.click(screen.getByRole('tab', { name: 'Default' }));
    await waitFor(() => expect(screen.getByTestId('harness-editor-value').textContent).toBe('null'));
  });

  it('presents scopes as tabs with a labelled panel, arrow-key navigation and a Project field', async () => {
    const harness = createHarness();
    installEditorProbe();
    await openAgentSettings(harness);
    const global = screen.getByRole('tab', { name: 'Default' });
    expect(global.className).not.toContain('btn');
    expect(global.tabIndex).toBe(0);
    expect(screen.getByRole('tab', { name: 'Project' }).tabIndex).toBe(-1);
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(global.id);
    expect(screen.queryByRole('combobox', { name: 'Project' })).toBeNull();

    fireEvent.keyDown(global, { key: 'ArrowLeft' });
    const project = screen.getByRole('tab', { name: 'Project' });
    expect(project.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(project);
    expect(screen.getByRole('tabpanel').textContent).toContain('Applies only to docs in this project, over Default.');
    expect((await screen.findByRole('combobox', { name: 'Project' })).className).toContain('dd-input');

    fireEvent.keyDown(project, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Default' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Default' }), { key: 'Enter' });
    expect(screen.getByRole('tab', { name: 'Default' }).getAttribute('aria-selected')).toBe('true');
  });

  it('saves a harness choice alongside the rows and clearing it alone inherits again', async () => {
    const harness = createHarness();
    installEditorProbe();
    await openAgentSettings(harness);
    await waitFor(() => expect(screen.getByTestId('harness-editor').getAttribute('data-loading')).toBe('false'));
    const key = JSON.stringify({ kind: 'global' });
    fireEvent.click(screen.getByRole('button', { name: 'run on codex' }));
    await waitFor(() => expect(screen.getByTestId('harness-editor-choice').textContent).toBe('codex'));
    expect(harness.harnessStore.get(key)).toEqual({ schemaVersion: 1, byAdapter: {}, defaultHarness: 'codex' });
    fireEvent.click(screen.getByRole('button', { name: 'choose sonnet' }));
    await waitFor(() => expect(screen.getByTestId('harness-editor-value').textContent).toContain('sonnet'));
    expect(harness.harnessStore.get(key)).toEqual({ schemaVersion: 1, byAdapter: { claude: { modelTargetId: 'sonnet' } }, defaultHarness: 'codex' });
    fireEvent.click(screen.getByRole('button', { name: 'clear model' }));
    await waitFor(() => expect(harness.harnessStore.get(key)).toEqual({ schemaVersion: 1, byAdapter: {}, defaultHarness: 'codex' }));
    fireEvent.click(screen.getByRole('button', { name: 'follow project harness' }));
    await waitFor(() => expect(screen.getByTestId('harness-editor-value').textContent).toBe('null'));
    expect(harness.harnessStore.has(key)).toBe(false);
    expect(screen.getByTestId('harness-editor-choice').textContent).toBe('');
  });

  it('shows the host rejection and keeps the stored value', async () => {
    const harness = createHarness({
      rpcOverrides: { setHarnessRouting: async () => { throw new Error('Claude Code cannot apply plan execution state.'); } }
    });
    installEditorProbe();
    await openAgentSettings(harness);
    await waitFor(() => expect(screen.getByTestId('harness-editor').getAttribute('data-loading')).toBe('false'));
    fireEvent.click(screen.getByRole('button', { name: 'choose sonnet' }));
    expect((await screen.findByRole('alert')).textContent).toContain('cannot apply plan execution state');
    expect(harness.toasts.at(-1)?.kind).toBe('error');
    expect(screen.getByTestId('harness-editor-value').textContent).toBe('null');
  });
});

describe('Design Docs agents spawn on the project AI harness', () => {
  it('spawns Ask agent with harness project-default and no provider', async () => {
    const harness = createHarness();
    const doc = harness.store.create({ title: 'Payments', template: 'blank', projectId: 'p1' }, USER);
    localStorage.setItem('zcc.design-docs.project-location:p1', JSON.stringify(doc.id));
    harness.render(<ProjectTab pluginId="design-docs" projectId="p1" />);
    fireEvent.click(await screen.findByRole('button', { name: /Ask agent/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /^Fill the gaps/ }));
    await waitFor(() => expect(harness.spawn).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'p1',
      harness: 'project-default'
    })));
    expect(harness.spawn.mock.calls[0]![0]).not.toHaveProperty('providerId');
    expect(harness.spawn.mock.calls[0]![0]).not.toHaveProperty('harnessRouting');
  });

  it('surfaces why the project harness cannot start the agent', async () => {
    const harness = createHarness();
    harness.spawn.mockRejectedValueOnce(new Error(
      'Claude Code cannot apply the AI harness override: the plan execution state is not supported by this thread provider. '
      + 'Change it in Settings → AI Harness.'
    ));
    const doc = harness.store.create({ title: 'Payments', template: 'blank', projectId: 'p1' }, USER);
    localStorage.setItem('zcc.design-docs.project-location:p1', JSON.stringify(doc.id));
    harness.render(<ProjectTab pluginId="design-docs" projectId="p1" />);
    fireEvent.click(await screen.findByRole('button', { name: /Ask agent/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /^Fill the gaps/ }));
    await waitFor(() => expect(harness.toasts.at(-1)?.kind).toBe('error'));
    expect(harness.toasts.at(-1)?.message).toContain(
      'Claude Code cannot apply the AI harness override: the plan execution state is not supported by this thread provider.'
    );
  });
});
