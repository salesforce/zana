/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SalesforceUiProvider } from '../components/client.js';
import { SoqlExplorerPanel } from './SoqlExplorerPanel.js';
import { copyText, downloadText } from './soql-export.js';

vi.mock('./soql-export.js', async (original) => ({
  ...await original<typeof import('./soql-export.js')>(),
  copyText: vi.fn(async () => {}),
  downloadText: vi.fn(),
}));

const org = { alias: 'dev', kind: 'sandbox', orgId: '00D000000000001', apiVersion: '62.0' };
const account = { name: 'Account', label: 'Accounts', queryable: true, source: 'standard' };
const entry = { id: 'saved', name: 'My accounts', soql: 'SELECT Id, Name FROM Account LIMIT 5', useToolingApi: false, includeDeleted: false, at: 1 };
const record = { Id: '001000000000001', Name: 'Acme' };
const page = { ok: true, org, records: [record], sobjectName: 'Account', soql: entry.soql, done: false, totalSize: 3, nextRecordsUrl: '/services/data/v62.0/query/page-2' };
const call = vi.fn();
const client = { call };
function respond(method: string) {
  switch (method) {
    case 'soql.describeGlobal': return { ok: true, org, catalogs: { standard: [account], tooling: [{ ...account, name: 'ApexClass' }] } };
    case 'soql.describeSObject': return { ok: true, describe: { name: 'Account', fields: [{ name: 'Id', type: 'id' }, { name: 'Name', type: 'string' }], childRelationships: [{ relationshipName: 'Contacts', childSObject: 'Contact' }] } };
    case 'soql.limits': return { ok: true, dailyApiRequests: { max: 1000, remaining: 990 } };
    case 'soql.history.list': return { ok: true, saved: [entry], recent: [] };
    case 'soql.history.save': return { ok: true, saved: [{ ...entry, name: 'New query' }] };
    case 'soql.history.remove': return { ok: true, saved: [], recent: [] };
    case 'soql.query': return page;
    case 'soql.queryMore': return { ...page, records: [{ Id: '001000000000002', Name: 'Next customer' }], nextRecordsUrl: undefined, done: true };
    case 'soql.explain': return { ok: true, plans: [{ leadingOperationType: 'Index' }] };
    default: return { ok: true };
  }
}
beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  call.mockImplementation(async (method: string) => respond(method));
});
afterEach(cleanup);

const panel = (alias = 'dev', extra = {}) => (
  <SalesforceUiProvider client={client}>
    <SoqlExplorerPanel pluginId="salesforce" projectId="p" orgAlias={alias} initialQuery={entry.soql} {...extra} />
  </SalesforceUiProvider>
);
async function mount(extra = {}) {
  const view = render(panel('dev', extra));
  await waitFor(() => expect(screen.getByTestId('soql-run').hasAttribute('disabled')).toBe(false));
  await waitFor(() => expect(call).toHaveBeenCalledWith('soql.history.list', expect.objectContaining({ orgAlias: 'dev' })));
  return view;
}
async function runQuery() {
  fireEvent.click(screen.getByTestId('soql-run'));
  await screen.findByRole('button', { name: 'Acme', exact: true });
  await screen.findByTestId('soql-run');
}
function deferred<T = unknown>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

describe('SOQL workbench interactions', () => {
  it('loads pages on the original target, inspects filtered records and stages evidence', async () => {
    const add = vi.fn();
    const open = vi.fn();
    await mount({ onAddToPrompt: add, onOpenRecord: open });
    await runQuery();
    fireEvent.click(screen.getByRole('button', { name: 'Load more', exact: true }));
    await screen.findByRole('button', { name: 'Next customer', exact: true });
    expect(call).toHaveBeenCalledWith('soql.queryMore', expect.objectContaining({ orgAlias: 'dev', projectId: 'p', requestId: expect.any(String) }));
    fireEvent.change(screen.getByLabelText('Search table'), { target: { value: 'Next customer' } });
    expect(screen.queryByRole('button', { name: 'Acme', exact: true })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Next customer', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Add displayed fields to prompt' }));
    expect(add).toHaveBeenCalledWith(expect.stringContaining('Next customer'));
    fireEvent.click(screen.getByRole('button', { name: 'Open beside agent' }));
    expect(open).toHaveBeenCalledWith('001000000000002', 'Account', 'dev');
    fireEvent.click(screen.getByRole('button', { name: 'Close', exact: true }));
    expect(screen.queryByText('Read only')).toBeNull();
  });

  it('requires confirmation to load all and stops late pagination results after Abort', async () => {
    const pending = deferred();
    await mount();
    await runQuery();
    call.mockImplementation((method: string) => method === 'soql.queryMore' ? pending.promise : Promise.resolve(respond(method)));
    fireEvent.click(screen.getByRole('button', { name: 'Load all', exact: true }));
    expect(call.mock.calls.some(([method]) => method === 'soql.queryMore')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByTestId('soql-abort');
    const request = call.mock.calls.find(([method]) => method === 'soql.queryMore')![1];
    fireEvent.click(screen.getByTestId('soql-abort'));
    await waitFor(() => expect(call).toHaveBeenCalledWith('soql.abort', expect.objectContaining({ requestId: request.requestId })));
    await act(async () => pending.resolve(respond('soql.queryMore')));
    expect(screen.queryByRole('button', { name: 'Next customer', exact: true })).toBeNull();
    expect(screen.getByTestId('soql-run').hasAttribute('disabled')).toBe(false);
    expect(screen.getByRole('button', { name: 'Acme', exact: true })).toBeTruthy();
  });

  it('aborts an initial query and on unmount even if the service returns a late success', async () => {
    const pending = deferred();
    const view = await mount();
    call.mockImplementation((method: string) => method === 'soql.query' ? pending.promise : Promise.resolve(respond(method)));
    fireEvent.click(screen.getByTestId('soql-run'));
    fireEvent.click(screen.getByTestId('soql-abort'));
    await act(async () => pending.resolve(page));
    expect(screen.queryByRole('button', { name: 'Acme', exact: true })).toBeNull();
    const next = deferred();
    call.mockImplementation((method: string) => method === 'soql.query' ? next.promise : Promise.resolve(respond(method)));
    fireEvent.click(screen.getByTestId('soql-run'));
    view.unmount();
    expect(call.mock.calls.filter(([method]) => method === 'soql.abort')).toHaveLength(2);
    await act(async () => next.resolve(page));
  });

  it.each(['save', 'remove'])('discards delayed history %s results after an org change', async action => {
    const pending = deferred();
    const view = await mount();
    fireEvent.click(screen.getByTestId('soql-history-toggle'));
    await screen.findByRole('button', { name: 'My accounts' });
    call.mockImplementation((method: string) => method === `soql.history.${action}` ? pending.promise : Promise.resolve(respond(method)));
    if (action === 'save') {
      fireEvent.click(screen.getByRole('button', { name: 'Save current' }));
      fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Old org query' } });
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    } else fireEvent.click(screen.getByRole('button', { name: 'Remove query' }));
    expect(call).toHaveBeenCalledWith(`soql.history.${action}`, expect.objectContaining({ orgAlias: 'dev' }));
    view.rerender(panel('other'));
    await waitFor(() => expect(call).toHaveBeenCalledWith('soql.history.list', expect.objectContaining({ orgAlias: 'other' })));
    await act(async () => pending.resolve({ ok: true, saved: [{ ...entry, name: 'Old org query' }], recent: [] }));
    expect(screen.queryByRole('button', { name: 'Old org query' })).toBeNull();
  });

  it('saves, selects and removes queries and displays service failures', async () => {
    await mount();
    fireEvent.click(screen.getByTestId('soql-history-toggle'));
    fireEvent.click(await screen.findByRole('button', { name: 'My accounts' }));
    expect((screen.getByTestId('soql-editor') as HTMLTextAreaElement).value).toBe(entry.soql);
    fireEvent.click(screen.getByRole('button', { name: 'Save current' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'New query' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByRole('button', { name: 'New query' });
    call.mockImplementation(async (method: string) => method === 'soql.history.remove' ? { ok: false, error: 'History unavailable' } : respond(method));
    fireEvent.click(screen.getByRole('button', { name: 'Remove query' }));
    await screen.findByText(/History unavailable/);
    call.mockImplementation(async (method: string) => respond(method));
    fireEvent.click(screen.getByRole('button', { name: 'Remove query' }));
    await screen.findByText('No saved queries.');
    fireEvent.click(screen.getByRole('button', { name: 'Close query list' }));
    expect(screen.queryByTestId('soql-history')).toBeNull();
  });

  it.each(['button', 'keyboard'])('saves directly from the editor using the %s, and ignores empty queries', async source => {
    await mount();
    if (source === 'button') fireEvent.click(screen.getByRole('button', { name: 'Save query' }));
    else fireEvent.keyDown(screen.getByTestId('soql-editor'), { key: 's', metaKey: true });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Account review' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(call).toHaveBeenCalledWith('soql.history.save', expect.objectContaining({ name: 'Account review', soql: entry.soql, orgAlias: 'dev' })));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.change(screen.getByTestId('soql-editor'), { target: { value: ' ' } });
    expect(screen.getByRole('button', { name: 'Save query' }).hasAttribute('disabled')).toBe(true);
    fireEvent.keyDown(screen.getByTestId('soql-editor'), { key: 's', ctrlKey: true });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it.each(['CSV', 'JSON', 'Excel'])('exports %s only after review', async kind => {
    await mount();
    await runQuery();
    fireEvent.change(screen.getByLabelText('Export results'), { target: { value: kind === 'Excel' ? 'copy-tsv' : kind.toLowerCase() } });
    expect(downloadText).not.toHaveBeenCalled();
    expect(copyText).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    if (kind === 'Excel') await waitFor(() => expect(copyText).toHaveBeenCalledWith(expect.stringContaining('Acme')));
    else expect(downloadText).toHaveBeenCalledWith(`soql.${kind.toLowerCase()}`, expect.stringContaining('Acme'), expect.any(String));
  });

  it('surfaces clipboard and query errors and clears them when the target changes', async () => {
    const view = await mount();
    await runQuery();
    vi.mocked(copyText).mockRejectedValueOnce(Error('Clipboard unavailable'));
    fireEvent.change(screen.getByLabelText('Export results'), { target: { value: 'copy-tsv' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByText(/Clipboard unavailable/);
    call.mockImplementation(async (method: string) => method === 'soql.query' ? { ok: false, error: 'Invalid field', line: 1, column: 8 } : respond(method));
    fireEvent.click(screen.getByTestId('soql-run'));
    await screen.findByText('Line 1:8 · Invalid field');
    view.rerender(panel('other'));
    await waitFor(() => expect(screen.queryByTestId('soql-editor-error')).toBeNull());
  });

  it('browses schema, builds a query, formats it and explains its plan', async () => {
    await mount();
    fireEvent.click(screen.getByTestId('soql-sobject:Account'));
    await screen.findByLabelText('Contacts');
    fireEvent.click(screen.getByLabelText('Contacts'));
    expect((screen.getByTestId('soql-editor') as HTMLTextAreaElement).value).toContain('FROM Contacts');
    fireEvent.click(screen.getByLabelText('Name'));
    fireEvent.click(screen.getByRole('button', { name: 'Format', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Explain', exact: true }));
    await screen.findByText(/leadingOperationType/);
    fireEvent.click(screen.getByLabelText('Tooling'));
    await screen.findByTestId('soql-sobject:ApexClass');
    fireEvent.click(screen.getByLabelText('Deleted'));
    fireEvent.change(screen.getByLabelText('Search sObjects'), { target: { value: 'missing' } });
    expect(screen.queryByTestId('soql-sobject:ApexClass')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse schema' }));
    fireEvent.click(screen.getByRole('button', { name: 'Expand schema' }));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh', exact: true }));
    await waitFor(() => expect(call).toHaveBeenCalledWith('soql.describeGlobal', expect.objectContaining({ forceRefresh: true })));
    fireEvent.change(screen.getByTestId('soql-editor'), { target: { value: entry.soql } });
    fireEvent.keyDown(screen.getByTestId('soql-editor'), { key: 'Enter', ctrlKey: true });
    await screen.findByRole('button', { name: 'Acme', exact: true });
  });
  it.each(['soql.limits', 'soql.history.list'])('keeps queries available when %s fails and retries without dropping results', async failed => {
    call.mockImplementation(async method => { if (method === failed) throw Error('Transport unavailable'); return respond(method); });
    await mount();
    await screen.findByText(/Queries are still available/);
    await runQuery();
    call.mockImplementation(async method => respond(method));
    fireEvent.click(screen.getByRole('button', { name: 'Retry details' }));
    await waitFor(() => expect(screen.queryByText(/Queries are still available/)).toBeNull());
    expect(screen.getByRole('button', { name: 'Acme', exact: true })).toBeTruthy();
  });

  it('does not wait for a slow usage request to load history, or apply stale optional results after an org switch', async () => {
    const usage = deferred();
    call.mockImplementation(async (method, args) => method === 'soql.limits' && args.orgAlias === 'dev' ? usage.promise : respond(method));
    const view = await mount();
    expect(call).toHaveBeenCalledWith('soql.history.list', expect.anything());
    view.rerender(panel('second'));
    await act(async () => usage.resolve({ ok: true, dailyApiRequests: { remaining: 123, max: 456 } }));
    expect(screen.queryByText('API 123/456')).toBeNull();
  });

});
