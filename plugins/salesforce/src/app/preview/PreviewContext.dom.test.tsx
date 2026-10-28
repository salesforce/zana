/** @vitest-environment happy-dom */
import { act } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PreviewContextEditor, PreviewContextSetup, PreviewContextTabs, usePreviewContext } from './PreviewContext.js';
import type { PreviewContextVariable } from '../../../lib/preview-context.js';

const rpc = vi.fn();
let current: ReturnType<typeof usePreviewContext>;
const fields = [
  { name: '$Context.sessionId', label: 'Session', type: 'Text', source: '@MessagingSession.Id', description: 'Messaging session' },
  { name: 'verified', label: 'Verified', type: 'Boolean' }, { name: 'count', label: 'Count', type: 'Number' },
  { name: 'details', label: 'Details', type: 'Json' }, { name: 'items', label: 'Items', type: 'List' },
  { name: 'day', label: 'Day', type: 'Date', defaultValue: '2026-10-20' }
];
function Harness({ scope = 'file1', source = 'source', running = false, error = '', path }: { scope?: string; source?: string; running?: boolean; error?: string; path?: string }) {
  const context = usePreviewContext({ pluginId: 'salesforce', projectId: 'p', scope, source, path }); current = context;
  return <div><PreviewContextTabs context={context} /><button onClick={() => context.setSetup(true)}>Setup</button>
    <PreviewContextEditor context={context} running={running} onRestart={() => context.setSetup(true)} />
    <output>{JSON.stringify(context.values)}</output>
    {context.setup && <PreviewContextSetup context={context} busy={false} running={running} error={error} onClose={() => context.setSetup(false)} onStart={() => { context.markApplied(context.values); context.setSetup(false); }} />}
  </div>;
}
beforeEach(() => {
  rpc.mockReset().mockResolvedValue({ ok: true, fields });
  (globalThis as Record<string, unknown>).__ZCC_PLUGIN_HOST__ = { callRpc: rpc };
});
afterEach(() => { cleanup(); vi.useRealTimers(); delete (globalThis as Record<string, unknown>).__ZCC_PLUGIN_HOST__; });
const options = (label: string) => fireEvent.click(screen.getByLabelText(`Options for ${label}`));
const enable = (label: string) => fireEvent.click(screen.getByRole('checkbox', { name: `Set ${label}` }));
describe('Preview context editor and setup', () => {
  it('edits values directly, groups linked inputs and keeps advanced actions out of the rows', async () => {
    render(<Harness />);
    await screen.findByRole('checkbox', { name: 'Set Session' });
    expect(screen.getByRole('region', { name: 'Agent variables' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Session context' })).toBeTruthy();
    expect(screen.getByLabelText('Options for Session').parentElement!.hasAttribute('open')).toBe(false);
    const value = screen.getByLabelText('Session value');
    expect(value.hasAttribute('disabled')).toBe(false);
    fireEvent.change(value, { target: { value: 'typed-directly' } });
    expect(current.values).toEqual([{ name: '$Context.sessionId', type: 'Text', value: 'typed-directly' }]);
    expect((screen.getByRole('checkbox', { name: 'Set Session' }) as HTMLInputElement).checked).toBe(true);
    options('Session');
    fireEvent.keyDown(screen.getByLabelText('Options for Session').parentElement!, { key: 'Escape' });
    expect(screen.getByLabelText('Options for Session').parentElement!.hasAttribute('open')).toBe(false);
    options('Session');
    fireEvent.click(within(screen.getByLabelText('Options for Session').parentElement!).getByRole('button', { name: 'Use runtime default' }));
    expect(current.values).toEqual([]);
    fireEvent.change(screen.getByLabelText('Verified value'), { target: { value: 'false' } });
    expect(current.values[0]!.value).toBe(false);
  });
  it('keeps one options menu open at a time and closes it on a press outside', async () => {
    render(<Harness />); await screen.findByRole('checkbox', { name: 'Set Session' });
    const menu = (label: string) => screen.getByLabelText(`Options for ${label}`).parentElement as HTMLDetailsElement;
    menu('Session').open = true;
    // Inside the open menu: it stays open.
    fireEvent.pointerDown(within(menu('Session')).getByRole('button', { name: 'Use runtime default' }));
    expect(menu('Session').open).toBe(true);
    // Opening another closes the first.
    fireEvent.pointerDown(screen.getByLabelText('Options for Verified'));
    menu('Verified').open = true;
    expect(menu('Session').open).toBe(false);
    // Focus moving elsewhere, or a press outside, closes it.
    fireEvent.focusIn(screen.getByLabelText('Count value'));
    expect(menu('Verified').open).toBe(false);
    menu('Verified').open = true;
    fireEvent.pointerDown(document.body);
    expect(menu('Verified').open).toBe(false);
  });
  it('keeps the manual variable form compact, cancellable and keyboard operable', async () => {
    render(<Harness />); await screen.findByRole('checkbox', { name: 'Set Session' });
    fireEvent.click(screen.getByRole('button', { name: '+ Add variable' }));
    expect(document.activeElement).toBe(screen.getByLabelText('Variable name'));
    fireEvent.change(screen.getByLabelText('Variable name'), { target: { value: 'locale' } });
    fireEvent.keyDown(screen.getByLabelText('Variable name'), { key: 'Enter' });
    expect(screen.queryByRole('group', { name: 'New context variable' })).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'Set locale' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '+ Add variable' }));
    fireEvent.keyDown(screen.getByRole('button', { name: 'Cancel adding variable' }), { key: 'Enter' });
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel adding variable' }));
    expect(screen.queryByLabelText('Variable name')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '+ Add variable' }));
    fireEvent.keyDown(screen.getByLabelText('Variable name'), { key: 'Escape' });
    expect(screen.queryByLabelText('Variable name')).toBeNull();
  });
  it('discovers inputs, keeps unset/empty/false/zero/null separate and validates structured JSON', async () => {
    render(<Harness />);
    await screen.findByRole('checkbox', { name: 'Set Session' });
    expect(current.values).toEqual([]);
    enable('Session'); enable('Verified'); enable('Count');
    fireEvent.change(screen.getByLabelText('Count value'), { target: { value: '0' } });
    expect(current.values.map(row => row.value)).toEqual(['', false, 0]);
    options('Session');
    fireEvent.click(screen.getByRole('button', { name: 'Set Session to null' }));
    expect(current.values[0]!.value).toBeNull();
    options('Session');
    fireEvent.click(screen.getByRole('button', { name: 'Set Session to null' }));
    fireEvent.change(screen.getByLabelText('Verified value'), { target: { value: 'true' } });
    expect(current.values[1]!.value).toBe(true);
    enable('Details');
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.blur(screen.getByLabelText('Details value'));
    expect(screen.getByRole('alert')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Details value'), { target: { value: '{"case":"500fake"}' } });
    enable('Items'); fireEvent.change(screen.getByLabelText('Items value'), { target: { value: '[]' } });
    enable('Day');
    expect(current.values.at(-1)!.value).toBe('2026-10-20');
    expect(current.error).toBe('');
    enable('Session'); expect(current.values.some(row => row.name === '$Context.sessionId')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Clear overrides' }));
    expect(current.values).toEqual([]);
  });
  it('adds and removes manual variables, rejects bad or duplicate names, and adopts Codex values', async () => {
    render(<Harness />); await screen.findByRole('checkbox', { name: 'Set Session' });
    fireEvent.click(screen.getByRole('button', { name: '+ Add variable' }));
    fireEvent.change(screen.getByLabelText('Variable name'), { target: { value: '../bad' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add', exact: true }));
    expect(screen.getByRole('alert').textContent).toContain('variable name');
    fireEvent.change(screen.getByLabelText('Variable name'), { target: { value: 'verified' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add', exact: true }));
    expect(screen.getByRole('alert').textContent).toContain('already listed');
    fireEvent.change(screen.getByLabelText('Variable name'), { target: { value: 'amount' } });
    fireEvent.change(screen.getByLabelText('Variable type'), { target: { value: 'Money' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add', exact: true }));
    enable('amount'); fireEvent.change(screen.getByLabelText('amount value'), { target: { value: '12.00' } });
    expect(current.values[0]!.value).toBe('12.00');
    options('amount');
    fireEvent.click(screen.getByRole('button', { name: 'Remove amount' }));
    expect(current.values).toEqual([]);
    const values = [{ name: 'agentSeed', type: 'Boolean', value: null }, { name: 'details', type: 'Json', value: { tier: 'Gold' } }] as PreviewContextVariable[];
    act(() => current.adopt(values));
    expect(current.values).toEqual(values);
    options('agentSeed');
    expect(screen.getByRole('button', { name: 'Remove agentSeed' })).toBeTruthy();
  });
  it('reviews context in an accessible setup dialog and retains immutable applied values when editing', async () => {
    render(<Harness running error="Start failed" />); await screen.findByRole('checkbox', { name: 'Set Session' });
    enable('Session'); fireEvent.change(screen.getByLabelText('Session value'), { target: { value: 'first' } });
    const setup = screen.getByRole('button', { name: 'Setup' }); setup.focus(); fireEvent.click(setup);
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.getElementById(dialog.getAttribute('aria-describedby')!)?.textContent).toContain('Review the values for your next run');
    expect(within(dialog).getByRole('alert').textContent).toBe('Start failed');
    const first = within(dialog).getByRole('button', { name: 'Close preview setup' });
    const last = within(dialog).getByRole('button', { name: 'Restart preview' });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true }); expect(document.activeElement).toBe(last);
    fireEvent.keyDown(last, { key: 'Tab' }); expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: 'Escape' }); expect(screen.queryByRole('dialog')).toBeNull(); expect(document.activeElement).toBe(setup);
    fireEvent.click(setup); fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Restart preview' }));
    expect(current.applied?.[0]!.value).toBe('first');
    fireEvent.change(screen.getByLabelText('Session value'), { target: { value: 'second' } });
    expect(current.applied?.[0]!.value).toBe('first');
    expect(screen.getByText(/keeps its original context/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Review & restart' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(current.applied?.[0]!.value).toBe('first');
  });
  it('supports keyboard tabs, clears on target changes and ignores stale discoveries', async () => {
    const view = render(<Harness />); await screen.findByRole('checkbox', { name: 'Set Session' });
    const conversation = screen.getByRole('tab', { name: 'Conversation' });
    fireEvent.keyDown(conversation, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Context 0' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Context 0' }), { key: 'Home' });
    expect(conversation.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(conversation, { key: 'End' });
    enable('Session');
    let complete!: (result: unknown) => void;
    rpc.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    view.rerender(<Harness scope="file2" />);
    expect(current.values).toEqual([]);
    rpc.mockResolvedValue({ ok: true, fields: [] });
    view.rerender(<Harness scope="file3" />);
    await screen.findByText(/No externally settable variables/);
    await act(async () => complete({ ok: true, fields }));
    expect(current.fields).toEqual([]);
  });
  it('explains discovery failures, retries edited source and drops removed or changed declarations', async () => {
    rpc.mockRejectedValueOnce(new Error('Read failed'));
    const view = render(<Harness />);
    await screen.findByText(/Could not discover variables: Read failed/);
    view.rerender(<Harness source="new source" />);
    await screen.findByRole('checkbox', { name: 'Set Count' }); enable('Count');
    fireEvent.change(screen.getByLabelText('Count value'), { target: { value: '0' } });
    rpc.mockResolvedValue({ ok: true, fields: [{ name: 'count', label: 'Count', type: 'Text' }] });
    view.rerender(<Harness source="different type" />);
    await waitFor(() => expect(current.fields).toHaveLength(1));
    expect(current.values).toEqual([]);
    enable('Count');
    rpc.mockResolvedValue({ ok: true, fields: [] });
    view.rerender(<Harness source="removed" />);
    await waitFor(() => expect(current.fields).toHaveLength(0));
    expect(current.values).toEqual([]);
  });
});

function presetRpcs() {
  let saved: import('../../../lib/preview-context-preset-contract.js').ContextPreset[] = [];
  rpc.mockImplementation(async (_plugin: string, method: string, args: any) => {
    if (method === 'agentPreview.context') return { ok: true, fields };
    if (method === 'agentPreview.presets.list') return { ok: true, presets: structuredClone(saved), scopeKey: 'trusted-scope', orgLabel: 'Dev sandbox' };
    if (method === 'agentPreview.presets.save') {
      const preset = { id: args.id ?? `p${saved.length + 1}`, revision: (args.expectedRevision ?? 0) + 1, updatedAt: 1, name: args.name, fields: args.fields, values: args.values };
      saved = [...saved.filter(p => p.id !== preset.id), structuredClone(preset)];
      return { ok: true, preset };
    }
    throw Error(method);
  });
  return { read: () => saved, seed: (rows: typeof saved) => { saved = rows; } };
}
const saveAs = async (name: string) => {
  fireEvent.click(screen.getByRole('button', { name: 'Save as…' }));
  fireEvent.change(screen.getByLabelText('Preset name'), { target: { value: name } });
  fireEvent.click(screen.getByRole('button', { name: 'Save preset' }));
  await waitFor(() => expect(screen.queryByLabelText('Preset name')).toBeNull());
};
const choose = (id: string) => fireEvent.change(screen.getByLabelText('Context preset'), { target: { value: id } });
describe('context presets and inline validation', () => {
  it('saves typed values, updates only explicitly, persists on reopen and tracks immutable applied provenance', async () => {
    const storage = presetRpcs(); const view = render(<Harness path="a.agent" />);
    await waitFor(() => expect((screen.getByLabelText('Context preset') as HTMLSelectElement).disabled).toBe(false));
    enable('Session'); enable('Verified'); fireEvent.change(screen.getByLabelText('Count value'), { target: { value: '0' } });
    await saveAs('Unverified');
    expect(storage.read()[0]!.values.map(v => v.value)).toEqual(['', false, 0]);
    expect(rpc.mock.calls.find(c => c[1] === 'agentPreview.presets.save')![2]).toMatchObject({ expectedScope: 'trusted-scope', fields: [expect.objectContaining({ declared: true }), expect.any(Object), expect.any(Object)] });
    act(() => current.markApplied(current.values));
    expect(current.appliedPreset).toMatchObject({ name: 'Unverified', revision: 1, edited: false });
    fireEvent.change(screen.getByLabelText('Count value'), { target: { value: '3' } });
    expect(screen.getByText('Edited')).toBeTruthy();
    expect(storage.read()[0]!.values.at(-1)!.value).toBe(0);
    fireEvent.click(screen.getByLabelText('Preset options'));
    fireEvent.click(screen.getByRole('button', { name: 'Update preset' }));
    await waitFor(() => expect(storage.read()[0]!.revision).toBe(2));
    expect(current.applied?.at(-1)!.value).toBe(0);
    expect(current.appliedPreset?.revision).toBe(1);
    expect(current.selected?.revision).toBe(2);
    view.unmount(); render(<Harness path="a.agent" />);
    await screen.findByRole('option', { name: 'Unverified' });
    expect(current.values).toEqual([]);
    choose('p1'); expect(current.values.at(-1)!.value).toBe(3);
  });
  it('switches complete snapshots and Undo restores raw invalid text, manual variables and selection', async () => {
    presetRpcs(); render(<Harness path="a.agent" />);
    await waitFor(() => expect(current.presetScope).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Count value'), { target: { value: '0' } }); await saveAs('Zero');
    fireEvent.click(screen.getByRole('button', { name: '+ Add variable' }));
    fireEvent.change(screen.getByLabelText('Variable name'), { target: { value: 'locale' } }); fireEvent.keyDown(screen.getByLabelText('Variable name'), { key: 'Enter' });
    fireEvent.change(screen.getByLabelText('locale value'), { target: { value: 'fr' } });
    fireEvent.change(screen.getByLabelText('Details value'), { target: { value: '{ "unfinished":' } });
    choose(''); expect(current.values).toEqual([]); expect(screen.queryByLabelText('locale value')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect((screen.getByLabelText('Details value') as HTMLTextAreaElement).value).toBe('{ "unfinished":');
    expect((screen.getByLabelText('locale value') as HTMLInputElement).value).toBe('fr');
    expect(current.selected?.name).toBe('Zero');
    choose('p1'); expect(current.values).toEqual([{ name: 'count', type: 'Number', value: 0 }]);
    expect(screen.queryByLabelText('locale value')).toBeNull();
    fireEvent.change(screen.getByLabelText('Count value'), { target: { value: '4' } });
    fireEvent.click(screen.getByLabelText('Preset options')); fireEvent.click(screen.getByRole('button', { name: 'Restore saved values' }));
    expect(current.values[0]!.value).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' })); expect(current.values[0]!.value).toBe(4);
    fireEvent.click(screen.getByRole('button', { name: 'Clear overrides' })); expect(current.values).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' })); expect(current.values[0]!.value).toBe(4);
  });
  it('validates on blur, focuses the first issue and blocks saving and starting without losing text', async () => {
    presetRpcs(); render(<Harness path="a.agent" />); await screen.findByLabelText('Count value');
    fireEvent.change(screen.getByLabelText('Count value'), { target: { value: '-' } });
    fireEvent.change(screen.getByLabelText('Details value'), { target: { value: '{' } });
    expect(screen.queryByRole('alert')).toBeNull();
    expect((screen.getByRole('button', { name: 'Save as…' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.blur(screen.getByLabelText('Count value')); expect(screen.getByRole('alert').textContent).toContain('Enter a number');
    expect(screen.getByLabelText('Count value').getAttribute('aria-invalid')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '2 values need attention' })); expect(document.activeElement).toBe(screen.getByLabelText('Count value'));
    expect(screen.getAllByRole('alert')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Setup' })); const dialog = screen.getByRole('dialog');
    expect((within(dialog).getByRole('button', { name: 'Start preview' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText('Count value'), { target: { value: '0' } });
    fireEvent.change(within(dialog).getByLabelText('Details value'), { target: { value: '{}' } });
    expect((within(dialog).getByRole('button', { name: 'Start preview' }) as HTMLButtonElement).disabled).toBe(false);
    expect(within(dialog).queryByRole('alert')).toBeNull();
  });
  it('preserves incompatible saved declarations for immediate review and allows manual runtime fields', async () => {
    const storage = presetRpcs();
    storage.seed([{ id: 'old', name: 'Old schema', revision: 1, updatedAt: 1,
      values: [{ name: 'count', type: 'Text', value: 'old' }, { name: 'removed', type: 'Text', value: 'kept' }, { name: 'locale', type: 'Text', value: 'fr' }],
      fields: [{ name: 'count', label: 'Count', type: 'Text', declared: true }, { name: 'removed', label: 'Removed', type: 'Text', declared: true }, { name: 'locale', label: 'Locale', type: 'Text', declared: false }] }]);
    render(<Harness path="a.agent" />); await screen.findByRole('option', { name: 'Old schema' }); choose('old');
    expect(screen.getByText('Needs review')).toBeTruthy(); expect(screen.getAllByRole('alert')).toHaveLength(2);
    expect((screen.getByLabelText('Removed value') as HTMLInputElement).value).toBe('kept');
    fireEvent.change(screen.getByLabelText('Count value'), { target: { value: '0' } });
    enable('Removed'); expect(screen.queryByLabelText('Removed value')).toBeNull();
    expect(current.error).toBe(''); expect(current.values).toContainEqual({ name: 'locale', type: 'Text', value: 'fr' });
  });
  it('retains saved overrides when an open script changes declarations', async () => {
    const storage = presetRpcs(); storage.seed([{ id: 's', name: 'Saved', revision: 1, updatedAt: 1,
      values: [{ name: 'count', type: 'Number', value: 0 }], fields: [{ name: 'count', label: 'Count', type: 'Number', declared: true }] }]);
    const view = render(<Harness path="a.agent" />); await screen.findByRole('option', { name: 'Saved' }); choose('s');
    const base = rpc.getMockImplementation()!;
    rpc.mockImplementation((p, m, a) => m === 'agentPreview.context' ? Promise.resolve({ ok: true, fields: [] }) : base(p, m, a));
    view.rerender(<Harness path="a.agent" source="changed" />);
    await screen.findByText('Needs review'); expect(current.entries.count?.text).toBe('0');
    expect(screen.getByLabelText('Count value')).toBeTruthy();
  });
  it('handles save conflicts and list failures without overwriting edits, and clears state on target changes', async () => {
    presetRpcs(); const view = render(<Harness path="a.agent" />); await waitFor(() => expect(current.presetScope).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Session value'), { target: { value: 'keep me' } });
    const base = rpc.getMockImplementation()!;
    rpc.mockImplementation((p, m, a) => m === 'agentPreview.presets.save' ? Promise.resolve({ ok: false, error: 'Changed in another window' }) : base(p, m, a));
    fireEvent.click(screen.getByRole('button', { name: 'Save as…' })); fireEvent.change(screen.getByLabelText('Preset name'), { target: { value: 'Copy' } }); fireEvent.click(screen.getByRole('button', { name: 'Save preset' }));
    await screen.findByText(/Changed in another window/); expect(current.entries['$Context.sessionId']?.text).toBe('keep me');
    fireEvent.keyDown(screen.getByLabelText('Preset name'), { key: 'Escape' }); expect(screen.queryByLabelText('Preset name')).toBeNull();
    rpc.mockImplementation((p, m, a) => m === 'agentPreview.presets.list' ? Promise.reject(Error('Offline')) : base(p, m, a));
    view.rerender(<Harness scope="other-org" path="a.agent" />);
    await screen.findByText(/Offline/); expect(current.entries).toEqual({}); expect(current.selected).toBeNull();
    rpc.mockImplementation(base); fireEvent.click(screen.getByRole('button', { name: 'Reload presets' })); await waitFor(() => expect(current.presetError).toBe(''));
    fireEvent.click(screen.getByRole('button', { name: 'Save as…' })); fireEvent.click(screen.getByRole('button', { name: 'Cancel saving preset' })); expect(screen.queryByLabelText('Preset name')).toBeNull();
  });
  it('reloads a newer revision without replacing edits until Restore is chosen', async () => {
    const storage = presetRpcs(); render(<Harness path="a.agent" />); await waitFor(() => expect(current.presetScope).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Count value'), { target: { value: '0' } }); await saveAs('Shared');
    fireEvent.change(screen.getByLabelText('Count value'), { target: { value: '-' } });
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.blur(screen.getByLabelText('Count value')); expect(screen.getByRole('alert')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Count value'), { target: { value: '2' } });
    storage.seed(storage.read().map(p => ({ ...p, revision: 2, values: [{ name: 'count', type: 'Number', value: 7 }] })));
    fireEvent.click(screen.getByLabelText('Preset options')); fireEvent.click(screen.getByRole('button', { name: 'Reload presets' }));
    await screen.findByText(/A newer revision is available/);
    expect(current.entries.count?.text).toBe('2'); expect(current.selected?.revision).toBe(1);
    fireEvent.click(screen.getByLabelText('Preset options')); fireEvent.click(screen.getByRole('button', { name: 'Restore saved values' }));
    expect(current.values[0]!.value).toBe(7); expect(current.selected?.revision).toBe(2);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' })); expect(current.entries.count?.text).toBe('2'); expect(current.selected?.revision).toBe(1);
  });
  it('ignores late list and save responses after switching agents', async () => {
    presetRpcs(); const base = rpc.getMockImplementation()!; let finish!: (r: unknown) => void;
    rpc.mockImplementation((p, m, a) => m === 'agentPreview.presets.list' ? new Promise(resolve => { finish = resolve; }) : base(p, m, a));
    const view = render(<Harness path="a.agent" />); await screen.findByLabelText('Count value');
    const old = finish; rpc.mockImplementation(base); view.rerender(<Harness scope="b" path="b.agent" />);
    await waitFor(() => expect(current.presetScope).toBeTruthy());
    await act(async () => old({ ok: true, presets: [], scopeKey: 'wrong' })); expect(current.presetScope).toBe('trusted-scope');
    rpc.mockImplementation((p, m, a) => m === 'agentPreview.presets.save' ? new Promise(resolve => { finish = resolve; }) : base(p, m, a));
    let pending!: Promise<boolean>; act(() => { pending = current.savePreset('Late'); });
    view.rerender(<Harness scope="c" path="c.agent" />);
    await act(async () => finish({ ok: true, preset: { id: 'late', name: 'Late' } })); expect(await pending).toBe(false); expect(current.selected).toBeNull();
  });
});
