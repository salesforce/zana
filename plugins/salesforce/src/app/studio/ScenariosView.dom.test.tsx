/** @vitest-environment happy-dom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { DuplicateScenarioDialog } from './DuplicateScenarioDialog.js';
import { ScenariosView } from './ScenariosView.js';
import { SaveSharedScenario } from './SaveSharedScenario.js';
import { clearStudioRunWorkspaces } from './run-workspaces.js';
import { starterScenarios, type SavedScenario } from '../../../lib/scenario-library-contract.js';
import type { ScenarioLibraryControls } from './useScenarioLibrary.js';

beforeEach(() => { clearStudioRunWorkspaces(); vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function () { this.open = true; }); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function setup(initial = starterScenarios(), error = '') {
  const save = vi.fn(async (input, id?, revision?) => ({ ...input, id: id ?? 'new-id', revision: (revision ?? 0) + 1, updatedAt: 123 }));
  const remove = vi.fn(async () => {}); const roleplay = vi.fn(); const batch = vi.fn(); const reload = vi.fn();
  const call = vi.fn(async (_p, method) => method === 'agentPreview.presets.list' ? { ok: true, presets: [{ id: 'p', name: 'Customer preset', revision: 2, values: [{ name: 'verified', type: 'Boolean', value: false }], fields: [] }] } : { ok: true, fields: [] });
  function Harness() {
    const [rows, setRows] = useState(initial);
    const library: ScenarioLibraryControls = { scenarios: rows, loading: false, error, reload, onManage: reload, save: async (...args) => { const row = await save(...args); setRows(previous => [...previous.filter(item => item.id !== row.id), row]); return row; }, remove: async row => { await remove(row); setRows(previous => previous.filter(item => item.id !== row.id)); } };
    return <ScenariosView library={library} pluginId="salesforce" projectId="p" path="Bot.agent" source="config:" onRoleplay={roleplay} onBatch={batch} call={call} />;
  }
  return { view: render(<Harness />), save, remove, roleplay, batch, reload, call };
}
it('edits a revision, copies typed presets and explicitly saves before sharing a scenario', async () => {
  const { save, roleplay, batch } = setup();
  expect(screen.queryByRole('group', { name: 'Filter scenarios' })).toBeNull(); expect(screen.queryByRole('checkbox', { name: 'Happy path' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Try in Role-play' })); expect(roleplay).toHaveBeenCalledWith(starterScenarios()[0]);
  fireEvent.change(screen.getByLabelText('Scenario 1 goal'), { target: { value: 'Create a quote' } });
  expect((screen.getByRole('button', { name: 'Add to batch' }) as HTMLButtonElement).disabled).toBe(true);
  await screen.findByRole('option', { name: 'Customer preset · revision 2' });
  fireEvent.change(screen.getByLabelText('Variable preset'), { target: { value: 'p' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await screen.findByText('Saved “Happy path” · revision 2.');
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ name: 'Happy path', goal: 'Create a quote', contextVariables: [{ name: 'verified', type: 'Boolean', value: false }] }), 'starter-1', 1);
  fireEvent.click(screen.getByRole('button', { name: 'Add to batch' })); expect(batch).toHaveBeenCalledWith(expect.objectContaining({ revision: 2 }));
});
it('keeps failed drafts, allows copies and discards local edits', async () => {
  const { save, reload } = setup(); save.mockRejectedValueOnce(Error('Scenario changed in another window'));
  fireEvent.change(screen.getByLabelText('Scenario 1 persona'), { target: { value: 'Custom persona' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' })); await screen.findByRole('alert');
  expect((screen.getByLabelText('Scenario 1 persona') as HTMLInputElement).value).toBe('Custom persona');
  fireEvent.click(screen.getByRole('button', { name: 'Reload scenarios' })); expect(reload).toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText('Scenario actions')); fireEvent.click(screen.getByRole('button', { name: 'Duplicate scenario…' }));
  fireEvent.change(screen.getByLabelText('New scenario name'), { target: { value: 'Custom' } });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel', exact: true }));
  fireEvent.click(screen.getByLabelText('Scenario actions')); fireEvent.click(screen.getByRole('button', { name: 'Duplicate scenario…' })); fireEvent.click(screen.getByRole('button', { name: 'Create copy' }));
  await screen.findByText('Saved “Happy path copy” · revision 1.');
  expect(save.mock.calls.at(-1)?.[1]).toBeUndefined();
  fireEvent.click(screen.getByRole('button', { name: 'Edit Happy path' })); fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
  expect((screen.getByLabelText('Scenario 1 persona') as HTMLInputElement).value).toBe(starterScenarios()[0].persona);
});
it('creates new drafts, validates required fields and confirms removal without touching old runs', async () => {
  const { save, remove } = setup([]);
  fireEvent.click(screen.getByRole('button', { name: 'Add your first scenario' }));
  expect((screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement).disabled).toBe(true);
  for (const field of ['persona', 'goal', 'criteria']) fireEvent.change(screen.getByLabelText(`Scenario 1 ${field}`), { target: { value: `Customer ${field}` } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' })); await screen.findByText('Saved “New scenario” · revision 1.'); expect(save).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Remove scenario 1' })); expect(screen.getByRole('alertdialog')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Keep scenario' })); expect(remove).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Remove scenario 1' })); fireEvent.click(screen.getByRole('button', { name: 'Remove scenario', exact: true }));
  await waitFor(() => expect(screen.getByText('Create your first scenario')).toBeTruthy()); expect(remove).toHaveBeenCalledWith(expect.objectContaining({ id: 'new-id', revision: 1 }));
  fireEvent.click(screen.getByRole('button', { name: 'New scenario' })); fireEvent.click(screen.getByRole('button', { name: 'Remove scenario 1' })); expect(remove).toHaveBeenCalledTimes(1);
});
it('reports catalogue and preset errors and reloads presets on request', async () => {
  const { view, call } = setup(undefined, 'Library unavailable'); expect(screen.getByRole('alert').textContent).toBe('Library unavailable');
  view.unmount();
  const broken = { scenarios: starterScenarios(), loading: false, error: '', reload: vi.fn(), save: vi.fn(), remove: vi.fn(), onManage: vi.fn() };
  const failedCall = vi.fn(async () => { throw Error('Preset unavailable'); });
  render(<ScenariosView library={broken} pluginId="salesforce" projectId="q" path="Bot.agent" source="config:" call={failedCall} onRoleplay={vi.fn()} onBatch={vi.fn()} />);
  await screen.findByText('Preset unavailable'); fireEvent.click(screen.getByRole('button', { name: 'Reload presets' })); await waitFor(() => expect(failedCall.mock.calls.length).toBe(4)); expect(call).toHaveBeenCalled();
});
it('saves local runner settings as a named shared copy and retains failures for correction', async () => {
  const library = { scenarios: [], loading: false, error: '', reload: vi.fn(), save: vi.fn(async () => starterScenarios()[0]), remove: vi.fn(), onManage: vi.fn() };
  render(<SaveSharedScenario library={library} scenario={starterScenarios()[0]} name="Local" values={[]} />);
  fireEvent.click(screen.getByRole('button', { name: 'Save as shared scenario' })); fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save as shared scenario' }));
  fireEvent.change(screen.getByLabelText('Shared scenario name'), { target: { value: 'Saved copy' } });
  library.save.mockRejectedValueOnce(Error('Duplicate name'));
  fireEvent.submit(screen.getByRole('button', { name: 'Save shared copy' }).closest('form')!); await screen.findByText('Duplicate name');
  fireEvent.submit(screen.getByRole('button', { name: 'Save shared copy' }).closest('form')!); await screen.findByText('Saved “Happy path” to Scenarios.');
  expect(library.save).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Saved copy', contextVariables: [] }));
});

it('opens a modal copy form, preserves naming errors and closes it with Escape', async () => {
  const { save } = setup();
  fireEvent.click(screen.getByLabelText('Scenario actions')); fireEvent.click(screen.getByRole('button', { name: 'Duplicate scenario…' }));
  const dialog = screen.getByRole('dialog', { name: 'Duplicate scenario' });
  expect(dialog.parentElement).toBe(document.body);
  fireEvent.change(screen.getByLabelText('New scenario name'), { target: { value: '' } });
  expect((screen.getByRole('button', { name: 'Create copy' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('New scenario name'), { target: { value: 'Existing' } });
  save.mockRejectedValueOnce(Error('A scenario with this name already exists.'));
  fireEvent.click(screen.getByRole('button', { name: 'Create copy' }));
  await screen.findByRole('alert');
  expect((screen.getByLabelText('New scenario name') as HTMLInputElement).value).toBe('Existing');
  const restoreFocus = vi.spyOn(screen.getByLabelText('Scenario actions'), 'focus');
  fireEvent(dialog, new Event('cancel', { bubbles: true, cancelable: true }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(restoreFocus).toHaveBeenCalled();
  expect((screen.getByLabelText('Scenario actions').closest('details') as HTMLDetailsElement).open).toBe(false);
});

it('keeps a pending copy modal open and rejects busy or blank submissions', () => {
  const trigger = document.createElement('button'); document.body.append(trigger); trigger.focus();
  const restoreFocus = vi.spyOn(trigger, 'focus'); const onClose = vi.fn(); const onCreate = vi.fn();
  const props = { name: 'Copy', busy: true, error: '', onName: vi.fn(), onClose, onCreate };
  const view = render(<DuplicateScenarioDialog {...props} />);
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
  fireEvent.submit(screen.getByLabelText('New scenario name').closest('form')!);
  expect(onClose).not.toHaveBeenCalled(); expect(onCreate).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Creating…' }).hasAttribute('disabled')).toBe(true);
  view.rerender(<DuplicateScenarioDialog {...props} busy={false} name="   " />);
  fireEvent.submit(screen.getByLabelText('New scenario name').closest('form')!);
  expect(onCreate).not.toHaveBeenCalled();
  view.unmount(); expect(restoreFocus).toHaveBeenCalled(); trigger.remove();
});
