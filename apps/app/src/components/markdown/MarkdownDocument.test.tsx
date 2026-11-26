// @vitest-environment jsdom
import { useEffect, useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import MarkdownDocument from './MarkdownDocument.js';
import { documentSearchRanges } from './document-search.js';

vi.mock('../../hooks/useMonacoTheme.js', () => ({ useMonacoTheme: () => 'light' }));
vi.mock('../../lib/monacoSetup.js', () => ({}));
const editor = vi.hoisted(() => ({ getAction: vi.fn(() => ({ run: vi.fn() })), getModel: () => ({ getPositionAt: () => ({ lineNumber: 8, column: 1 }) }), saveViewState: vi.fn(() => ({})), restoreViewState: vi.fn(), setPosition: vi.fn(), revealPositionInCenter: vi.fn(), focus: vi.fn() }));
vi.mock('../explorer/ExplorerEditor.js', () => ({ default: ({ value, onChange, options, onMount }: any) => {
  useEffect(() => { onMount?.(editor, {}); }, []);
  return <textarea aria-label="Markdown source" value={value} readOnly={options.readOnly} onChange={event => onChange(event.target.value)} />;
} }));
vi.mock('../../views/library/library/LibraryMarkdownEditor.js', () => ({ LibraryMarkdownEditor: ({ value, onChange, editable }: any) => <textarea className="tiptap" aria-label="Document content" value={value} readOnly={!editable} onChange={event => onChange(event.target.value)} /> }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

function Harness({ original = '# Heading\n\nA **bold** phrase\n\n- [ ] Task\n', readOnly = false, save = vi.fn() }: { original?: string; readOnly?: boolean; save?: () => void }) {
  const [value, setValue] = useState(original);
  return <><output data-testid="draft">{value}</output><MarkdownDocument value={value} savedValue={original} documentPath="/repo/doc.md" onChange={setValue} onSave={save} readOnlyReason={readOnly ? 'This file is read only.' : undefined} /></>;
}

it('checks tasks into the draft, saves explicitly, and undoes across view changes', async () => {
  const save = vi.fn(); render(<Harness save={save} />);
  fireEvent.click(screen.getByRole('checkbox'));
  expect(screen.getByTestId('draft').textContent).toContain('- [x] Task');
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true })); expect(save).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Source', exact: true }));
  expect((await screen.findByLabelText('Markdown source') as HTMLTextAreaElement).value).toContain('[x]');
  fireEvent.change(screen.getByLabelText('Markdown source'), { target: { value: '# Changed' } });
  fireEvent.click(screen.getByRole('button', { name: 'Read', exact: true }));
  expect(screen.getByRole('heading').textContent).toBe('Changed');
  fireEvent.click(screen.getByRole('button', { name: 'Undo document change' }));
  expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Undo document change' }));
  expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Redo document change' }));
  expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
});

it('keeps keyboard focus on a checklist item after changing it', () => {
  render(<Harness />);
  const checkbox = screen.getByRole('checkbox');
  checkbox.focus();
  fireEvent.click(checkbox);
  expect(screen.getByTestId('draft').textContent).toContain('- [x] Task');
  expect(document.activeElement).toBe(checkbox);
  fireEvent.click(checkbox);
  expect(screen.getByTestId('draft').textContent).toContain('- [ ] Task');
});

it('edits the complete document without per-block controls and keeps advanced source', async () => {
  const original = '---\ntitle: keep\n---\n\n# Heading\n\n<!--keep-->\n\nText\n';
  render(<Harness original={original} />);
  fireEvent.click(screen.getByRole('button', { name: 'Edit', exact: true }));
  const editor = await screen.findByLabelText('Document content');
  expect((editor as HTMLTextAreaElement).value).toBe(original);
  expect(screen.queryByRole('button', { name: 'Edit block' })).toBeNull();
  fireEvent.change(editor, { target: { value: original.replace('# Heading', '# Changed') + '\nAdded' } });
  expect(screen.getByTestId('draft').textContent).toBe(original.replace('# Heading', '# Changed') + '\nAdded');
  fireEvent.click(screen.getByRole('button', { name: 'Read', exact: true }));
  expect(screen.getByRole('heading').textContent).toBe('Changed');
  fireEvent.click(screen.getByRole('button', { name: 'Edit', exact: true }));
  expect(screen.getByLabelText('Document content')).toBe(editor);
});

it('finds across inline markup and code with scoped keyboard navigation and cleanup', async () => {
  render(<Harness original={'A **bold** phrase\n\n```txt\nA bold phrase\n```'} />);
  const outside = document.createElement('input'); document.body.append(outside);
  fireEvent.keyDown(outside, { key: 'f', ctrlKey: true }); expect(screen.queryByRole('search')).toBeNull(); outside.remove();
  const root = screen.getByLabelText('Markdown document');
  expect(root.hasAttribute('data-own-find')).toBe(true);
  fireEvent.keyDown(root, { key: 'f', ctrlKey: true });
  const find = screen.getByRole('textbox', { name: 'Find in document' });
  fireEvent.change(find, { target: { value: 'A bold phrase' } });
  await screen.findByText('1 of 2');
  fireEvent.keyDown(find, { key: 'Enter' }); await screen.findByText('2 of 2');
  fireEvent.keyDown(find, { key: 'Enter', shiftKey: true }); await screen.findByText('1 of 2');
  fireEvent.click(screen.getByRole('button', { name: 'Previous match' })); await screen.findByText('2 of 2');
  fireEvent.click(screen.getByRole('button', { name: 'Next match' })); await screen.findByText('1 of 2');
  fireEvent.keyDown(find, { key: 'Escape' }); expect(screen.queryByRole('search')).toBeNull();
});

it('keeps unsupported sources read-only while allowing source inspection', async () => {
  const save = vi.fn(); render(<Harness readOnly save={save} />);
  expect((screen.getByRole('checkbox') as HTMLInputElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: 'Edit', exact: true }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByRole('button', { name: 'Save', exact: true })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Source', exact: true }));
  expect((await screen.findByLabelText('Markdown source') as HTMLTextAreaElement).readOnly).toBe(true);
  expect(save).not.toHaveBeenCalled();
});

it('search is literal, bounded, skips toolbars, and spans inline marks', () => {
  const root = document.createElement('div');
  root.innerHTML = '<p>a <b>bold</b> phrase a bold phrase</p><button>a bold phrase</button><div aria-hidden="true">a bold phrase</div><div hidden>a bold phrase</div>';
  expect(documentSearchRanges(root, 'a bold phrase').map(range => range.toString())).toEqual(['a bold phrase', 'a bold phrase']);
  expect(documentSearchRanges(root, 'a', 1)).toHaveLength(1);
  expect(documentSearchRanges(root, '')).toEqual([]);
  expect(documentSearchRanges(root, 'x'.repeat(501))).toEqual([]);
  expect(documentSearchRanges(root, 'none')).toEqual([]);
});

it('uses native Source find and retains a BOM after typing', async () => {
  render(<Harness original={'\uFEFF# Heading\n\n<!-- opaque -->\n'} />);
  fireEvent.click(screen.getByRole('button', { name: 'Edit', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Source', exact: true }));
  await screen.findByLabelText('Markdown source');
  fireEvent.click(screen.getByRole('button', { name: 'Find', exact: true }));
  expect(editor.getAction).toHaveBeenCalledWith('actions.find');
  fireEvent.change(screen.getByLabelText('Markdown source'), { target: { value: '# New' } });
  expect(screen.getByTestId('draft').textContent).toBe('\uFEFF# New');
});
it('paints independent highlights, supports scoped save and keyboard undo, and cleans up', async () => {
  const registry = new Map();
  vi.stubGlobal('CSS', { highlights: registry });
  vi.stubGlobal('Highlight', class { constructor(public ranges: unknown[]) {} });
  const save = vi.fn(); const view = render(<Harness save={save} />);
  const root = screen.getByLabelText('Markdown document');
  fireEvent.keyDown(root, { key: 'z', ctrlKey: true });
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.keyDown(root, { key: 's', ctrlKey: true }); expect(save).toHaveBeenCalledOnce();
  fireEvent.keyDown(root, { key: 'z', ctrlKey: true }); expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
  fireEvent.keyDown(root, { key: 'z', ctrlKey: true, shiftKey: true }); expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Find', exact: true }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Find in document' }), { target: { value: 'phrase' } });
  await screen.findByText('1 of 1'); expect(registry.size).toBe(2);
  fireEvent.click(screen.getByRole('button', { name: 'Close document search' })); expect(registry.size).toBe(0);
  fireEvent.click(screen.getByRole('button', { name: 'Find', exact: true })); view.unmount(); expect(registry.size).toBe(0);
});
it('reconciles external recovery in the continuous editor without emitting a change', async () => {
  const change = vi.fn();
  const props = { value: '# Original', savedValue: '# Original', documentPath: '/repo/doc.md', onChange: change };
  const view = render(<MarkdownDocument {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Edit', exact: true }));
  const rich = await screen.findByLabelText('Document content');
  view.rerender(<MarkdownDocument {...props} value="# External" />);
  expect((rich as HTMLTextAreaElement).value).toBe('# External');
  expect(change).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Read', exact: true }));
  expect(screen.getByRole('heading').textContent).toBe('External');
});

it('restores each view position and the Source cursor when switching modes', async () => {
  const view = render(<Harness />);
  const preview = () => view.container.querySelector('.md-document-preview')!;
  preview().scrollTop = 145;
  fireEvent.click(screen.getByRole('button', { name: 'Edit', exact: true }));
  await screen.findByLabelText('Document content');
  preview().scrollTop = 280;
  fireEvent.click(screen.getByRole('button', { name: 'Read', exact: true }));
  expect(preview().scrollTop).toBe(145);
  fireEvent.click(screen.getByRole('button', { name: 'Edit', exact: true }));
  expect(preview().scrollTop).toBe(280);
  fireEvent.click(screen.getByRole('button', { name: 'Source', exact: true }));
  await screen.findByLabelText('Markdown source');
  fireEvent.click(screen.getByRole('button', { name: 'Read', exact: true }));
  expect(editor.saveViewState).toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Source', exact: true }));
  await screen.findByLabelText('Markdown source');
  expect(editor.restoreViewState).toHaveBeenCalledWith({});
});

it.each(['', '# Heading\r\n', '# Heading\r\n\r\n', '# Heading\r\n\r\nText'])('keeps original line endings when opening Edit for %j', async original => {
  render(<Harness original={original} />);
  fireEvent.click(screen.getByRole('button', { name: 'Edit', exact: true }));
  const rich = await screen.findByLabelText('Document content');
  expect((rich as HTMLTextAreaElement).value).toBe(original.replace(/\r\n/g, '\n'));
  expect(screen.getByTestId('draft').textContent).toBe(original);
  expect(fireEvent.keyDown(rich, { key: 'z', ctrlKey: true })).toBe(true);
});

it('leaves Undo in the Find field to its native text editing', async () => {
  render(<Harness />);
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Find', exact: true }));
  const find = screen.getByRole('textbox', { name: 'Find in document' });
  fireEvent.change(find, { target: { value: 'Task' } });
  expect(fireEvent.keyDown(find, { key: 'z', ctrlKey: true })).toBe(true);
  expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
});
