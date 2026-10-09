/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SoqlResultsGrid } from './SoqlResultsGrid.js';
import { KeyValueList, keyValueLines, keyValueText } from '../components/KeyValue.js';

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
