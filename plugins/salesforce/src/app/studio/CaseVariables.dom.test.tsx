/** @vitest-environment happy-dom */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CaseVariables } from './CaseVariables.js';
import { clearStudioRunWorkspaces } from './run-workspaces.js';
import type { ContextPreset } from '../../../lib/preview-context-preset-contract.js';
const preset: ContextPreset = { id: 'existing', name: 'Existing customer', revision: 1, updatedAt: 1, fields: [], values: [{ name: 'verified', type: 'Boolean', value: false }, { name: 'count', type: 'Number', value: 0 }] };
let channels: Record<string, (payload: unknown) => void>;
beforeEach(() => { clearStudioRunWorkspaces(); channels = {}; (globalThis as any).__ZCC_PLUGIN_RUNTIME__ = { useRealtime: (name: string, handler: (payload: unknown) => void) => { channels[name] = handler; } }; });
afterEach(() => { cleanup(); clearStudioRunWorkspaces(); delete (globalThis as any).__ZCC_PLUGIN_RUNTIME__; });
function setup(extra: Partial<Parameters<typeof CaseVariables>[0]> = {}) {
  const props = { scenario: { id: 'case1', name: 'Case', utterances: ['Hello'], expect: {} }, path: 'Bot.agent', source: 'source', projectId: 'p', disabled: false, rpc: vi.fn(async (method: string) => method.endsWith('list') ? { ok: true, presets: [preset] } : { ok: true, fields: [] }), onSave: vi.fn(async () => {}), ...extra };
  const view = render(<CaseVariables {...props} />); return { props, ...view };
}
const selectPreset = async () => { await screen.findByRole('option', { name: 'Existing customer · revision 1' }); fireEvent.change(screen.getByLabelText('Variable preset'), { target: { value: 'existing' } }); };
it('reuses a saved preset, allows overrides, saves typed values and discards later edits', async () => {
  const { props } = setup(); await selectPreset();
  expect((screen.getByLabelText('verified value') as HTMLSelectElement).value).toBe('false');
  fireEvent.change(screen.getByLabelText('count value'), { target: { value: '2' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save case variables' }));
  await screen.findByText(/Starting variables saved/);
  expect(props.onSave).toHaveBeenCalledWith([{ name: 'verified', type: 'Boolean', value: false }, { name: 'count', type: 'Number', value: 2 }], []);
  fireEvent.change(screen.getByLabelText('count value'), { target: { value: '3' } });
  fireEvent.click(screen.getByRole('button', { name: 'Discard changes' })); expect((screen.getByLabelText('count value') as HTMLInputElement).value).toBe('2');
});
it('retains drafts across tabs and scopes them by case and project', async () => {
  const { props, unmount } = setup(); await selectPreset(); unmount();
  const again = render(<CaseVariables {...props} />); expect((screen.getByLabelText('count value') as HTMLInputElement).value).toBe('0');
  again.rerender(<CaseVariables {...props} scenario={{ ...props.scenario, id: 'other' }} />); expect(screen.queryByLabelText('count value')).toBeNull();
  again.rerender(<CaseVariables {...props} projectId="other" />); expect(screen.queryByLabelText('count value')).toBeNull();
});
it('keeps chosen values when the shared preset changes and reloads only relevant events', async () => {
  const { props } = setup(); await selectPreset();
  props.rpc.mockImplementation(async method => method.endsWith('list') ? { ok: true, presets: [{ ...preset, revision: 2, values: [] }] } : { ok: true, fields: [] });
  const before = props.rpc.mock.calls.length;
  await act(async () => channels['salesforce.context-presets.changed']({ projectId: 'other' })); expect(props.rpc).toHaveBeenCalledTimes(before);
  await act(async () => channels['salesforce.context-presets.changed']({ projectId: 'p' }));
  await screen.findByRole('option', { name: 'Existing customer · revision 2' });
  expect((screen.getByLabelText('count value') as HTMLInputElement).value).toBe('0');
  await act(async () => channels['context.changed']({ projectId: 'p' })); expect(props.rpc.mock.calls.length).toBe(before + 4);
});
it('blocks invalid values, reports failed saves and does not replace a newer saved case', async () => {
  const onSave = vi.fn(async () => { throw Error('Suite changed'); });
  const { props, rerender } = setup({ onSave }); await selectPreset();
  fireEvent.change(screen.getByLabelText('count value'), { target: { value: '-' } }); expect((screen.getByRole('button', { name: 'Save case variables' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('count value'), { target: { value: '0' } }); fireEvent.click(screen.getByRole('button', { name: 'Save case variables' })); await screen.findByText('Suite changed');
  rerender(<CaseVariables {...props} scenario={{ ...props.scenario, contextVariables: [{ name: 'count', type: 'Number', value: 5 }] }} />);
  expect((screen.getByRole('button', { name: 'Save case variables' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Reload saved values' })); expect((screen.getByLabelText('count value') as HTMLInputElement).value).toBe('5'); expect(screen.queryByText('Suite changed')).toBeNull();
});
it('recovers failed catalogue loading and disables editing while saving', async () => {
  let finish!: () => void;
  const { props } = setup({ rpc: vi.fn(async () => { throw Error('Offline'); }), onSave: vi.fn(() => new Promise<void>(resolve => { finish = resolve; })) });
  await screen.findByText(/Offline/); props.rpc.mockImplementation(async method => method.endsWith('list') ? { ok: true, presets: [preset] } : { ok: true, fields: [] });
  fireEvent.click(screen.getByRole('button', { name: 'Reload presets' })); await selectPreset();
  fireEvent.click(screen.getByRole('button', { name: 'Save case variables' }));
  expect((screen.getByLabelText('count value').closest('fieldset') as HTMLFieldSetElement).disabled).toBe(true);
  await act(async () => finish()); await screen.findByText(/Starting variables saved/);
});
it('handles unsuccessful RPC replies and ignores responses after leaving the setup', async () => {
  const view = setup({ rpc: vi.fn(async () => ({ ok: false, error: 'No org' })) }); await screen.findByText(/No org/); view.unmount();
  let resolve!: (value: any) => void;
  const pending = setup({ rpc: vi.fn(() => new Promise(r => { resolve = r; })) }); pending.unmount();
  await act(async () => resolve({ ok: true, fields: [], presets: [preset] })); expect(screen.queryByText('Starting variables')).toBeNull();
});
