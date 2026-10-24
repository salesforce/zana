/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SoqlResultsGrid } from './SoqlResultsGrid.js';
import { copyText } from './soql-export.js';
import { KeyValueList, keyValueLines, keyValueText } from '../components/KeyValue.js';

vi.mock('./soql-export.js', async (original) => ({
  ...await original<typeof import('./soql-export.js')>(),
  copyText: vi.fn(async () => true),
}));

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const records = [{ Id: '001A', Name: 'Acme', Status: 'Open' }, { Id: '001B', Name: 'Globex', Status: 'Closed' }];
const width = (w: number) => vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: w, height: 400, top: 0, left: 0, right: w, bottom: 400, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);

describe('SoqlResultsGrid', () => {
  it('renders a table when wide and cards when narrow', () => {
    width(900);
    const { unmount } = render(<SoqlResultsGrid records={records} search="" />);
    expect(screen.getByRole('table')).toBeTruthy();
    expect(screen.queryByTestId('soql-cards')).toBeNull();
    unmount();
    width(320);
    const onSelect = vi.fn();
    render(<SoqlResultsGrid records={records} search="glob" onSelectRecord={onSelect} />);
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByTestId('soql-cards').children).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Globex' }));
    expect(onSelect).toHaveBeenCalledWith(records[1]);
  });
  it('renders static card titles without a selection handler', () => {
    width(320);
    render(<SoqlResultsGrid records={[{ Id: '1', Amount: 5 }]} search="" />);
    expect(screen.getByTestId('soql-cards').textContent).toContain('Amount');
  });
});

describe('SoqlResultsGrid count results', () => {
  const noMatch = 'No records matched this query.';
  it('shows a positive totalSize with no rows as a count, never as an empty result', () => {
    render(<SoqlResultsGrid records={[]} hasRun totalSize={1234} search="" />);
    expect(screen.getByTestId('soql-results-count')).toBeTruthy();
    expect(screen.getByTestId('soql-results-count-value').textContent).toBe((1234).toLocaleString());
    expect(screen.queryByText(noMatch)).toBeNull();
    expect(screen.getByText('COUNT(Id)')).toBeTruthy();
  });
  it('shows a zero count only for a bare COUNT() query', () => {
    const { unmount } = render(<SoqlResultsGrid records={[]} hasRun totalSize={0} countQuery search="" />);
    expect(screen.getByTestId('soql-results-count').textContent).toContain('Count: 0');
    expect(screen.queryByText(noMatch)).toBeNull();
    unmount();
    render(<SoqlResultsGrid records={[]} hasRun totalSize={0} search="" />);
    expect(screen.queryByTestId('soql-results-count')).toBeNull();
    expect(screen.getByText(noMatch)).toBeTruthy();
  });
  it('keeps the empty state without a usable totalSize, and the other states first', () => {
    const { rerender } = render(<SoqlResultsGrid records={[]} hasRun countQuery search="" />);
    expect(screen.getByText(noMatch)).toBeTruthy();
    rerender(<SoqlResultsGrid records={[]} hasRun countQuery totalSize={Number.NaN} search="" />);
    expect(screen.getByText(noMatch)).toBeTruthy();
    rerender(<SoqlResultsGrid records={[]} hasRun busy totalSize={1234} countQuery search="" />);
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.queryByTestId('soql-results-count')).toBeNull();
    rerender(<SoqlResultsGrid records={[]} totalSize={1234} countQuery search="" />);
    expect(screen.getByText('Run a query to see records.')).toBeTruthy();
    expect(screen.queryByTestId('soql-results-count')).toBeNull();
  });
  it('copies the plain digits and shows Copied only on success', async () => {
    render(<SoqlResultsGrid records={[]} hasRun totalSize={1234} search="" />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy count' })); });
    expect(copyText).toHaveBeenCalledWith('1234');
    expect(screen.getByRole('button', { name: 'Count copied' }).textContent).toBe('Copied');
  });
  it('keeps Copy when the copy fails, and resets it when the count changes', async () => {
    vi.mocked(copyText).mockResolvedValueOnce(false);
    const { rerender } = render(<SoqlResultsGrid records={[]} hasRun totalSize={7} search="" />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy count' })); });
    expect(screen.getByRole('button', { name: 'Copy count' }).textContent).toBe('Copy');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy count' })); });
    expect(screen.getByRole('button', { name: 'Count copied' }).textContent).toBe('Copied');
    rerender(<SoqlResultsGrid records={[]} hasRun totalSize={8} search="" />);
    expect(screen.getByRole('button', { name: 'Copy count' }).textContent).toBe('Copy');
  });
  it('ignores a copy that finishes after the count changed', async () => {
    let finish!: (ok: boolean) => void;
    vi.mocked(copyText).mockReturnValueOnce(new Promise<boolean>(done => { finish = done; }));
    const { rerender } = render(<SoqlResultsGrid records={[]} hasRun totalSize={7} search="" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy count' }));
    rerender(<SoqlResultsGrid records={[]} hasRun totalSize={8} search="" />);
    await act(async () => finish(true));
    expect(screen.getByRole('button', { name: 'Copy count' }).textContent).toBe('Copy');
  });
  it('leaves results with records unchanged', () => {
    width(900);
    render(<SoqlResultsGrid records={records} hasRun totalSize={3} countQuery search="" />);
    expect(screen.queryByTestId('soql-results-count')).toBeNull();
    expect(screen.getByText('2 loaded of 3')).toBeTruthy();
  });
});

describe('KeyValue', () => {
  it('renders nested values, scalars, empties and truncates deep structures', () => {
    render(<KeyValueList value={{ a: 1, b: null, c: { d: [1, { e: { f: 2 } }] }, g: [] }} />);
    expect(screen.getAllByTestId('key-value').length).toBeGreaterThan(1);
    expect(document.body.textContent).toContain('—');
    expect(document.body.textContent).toContain('{"f":2}');
    cleanup();
    render(<KeyValueList value="plain" />);
    expect(screen.getByText('plain')).toBeTruthy();
    cleanup();
    render(<KeyValueList value={{}} />);
    expect(screen.getByText('(empty)')).toBeTruthy();
  });
  it('flattens to bounded text lines', () => {
    expect(keyValueLines({ a: { b: 1 }, c: [2], d: undefined })).toEqual(['a.b: 1', 'c.1: 2', 'd: —']);
    expect(keyValueLines('x')).toEqual(['value: x']);
    expect(keyValueLines({ a: { b: { c: { d: 1 } } } })).toEqual(['a.b.c: {"d":1}']);
    expect(keyValueText({ k: 'x'.repeat(50) }, 10)).toHaveLength(10);
    const big = Object.fromEntries(Array.from({ length: 205 }, (_, i) => [`k${i}`, i]));
    expect(keyValueLines(big).at(-1)).toBe('… 5 more');
    render(<KeyValueList value={big} />);
    expect(document.body.textContent).toContain('5 more');
  });
});
