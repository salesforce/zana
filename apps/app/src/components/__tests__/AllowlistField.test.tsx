// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AllowlistField, parseAllowlistText, type AllowlistFieldProps } from '../AllowlistField.js';

afterEach(cleanup);

function Harness(props: Partial<AllowlistFieldProps> & { initial?: string[]; initialRestricted?: boolean; spy?: (v: string[]) => void }) {
  const [restricted, setRestricted] = useState(props.initialRestricted ?? true);
  const [entries, setEntries] = useState<string[]>(props.initial ?? []);
  return (
    <AllowlistField
      testId="f" checkboxId="f-restrict" title="Restrict things" inputLabel="Add thing" placeholder="type"
      alwaysAllowed={['zcc-inbox']} exactHint="exact" emptyHint="empty"
      suggestions={[{ value: 'alpha', hint: 'user' }, { value: 'beta', hint: 'plugin' }, { value: 'alphabet' }]}
      {...props}
      restricted={restricted} onRestrictedChange={setRestricted}
      entries={entries} onEntriesChange={(v) => { setEntries(v); props.spy?.(v); }}
    />
  );
}
const input = () => screen.getByLabelText('Add thing') as HTMLInputElement;
const chips = () => screen.queryAllByTestId('allowlist-chip').map((c) => c.textContent);

describe('AllowlistField', () => {
  it('is a tri-state: unchecked hides the body, checked with no entries shows the empty hint and fixed chip', () => {
    render(<Harness initialRestricted={false} />);
    expect(screen.queryByLabelText('Add thing')).toBeNull();
    fireEvent.click(screen.getByLabelText('Restrict things'));
    expect(screen.getByTestId('allowlist-hint').textContent).toBe('empty');
    expect(screen.getByTestId('allowlist-fixed-chip').textContent).toContain('zcc-inbox (always)');
    expect(screen.queryByRole('button', { name: /Remove zcc-inbox/ })).toBeNull();
  });

  it('adds with Enter, dedupes, removes via chip button, shows the exact hint', () => {
    render(<Harness />);
    fireEvent.change(input(), { target: { value: 'gamma' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    fireEvent.change(input(), { target: { value: 'gamma' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(chips()).toEqual(['gamma']);
    expect(screen.getByTestId('allowlist-hint').textContent).toBe('exact');
    fireEvent.click(screen.getByRole('button', { name: 'Remove gamma' }));
    expect(chips()).toEqual([]);
  });

  it('typeahead filters, excludes added entries, navigates with arrows and Enter, closes on Escape', () => {
    render(<Harness initial={['beta']} />);
    fireEvent.change(input(), { target: { value: 'alp' } });
    expect(input().getAttribute('aria-expanded')).toBe('true');
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['alphauser', 'alphabet']);
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    fireEvent.keyDown(input(), { key: 'ArrowUp' });
    expect(screen.getAllByRole('option')[0].getAttribute('aria-selected')).toBe('true');
    expect(input().getAttribute('aria-activedescendant')).toBeTruthy();
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(chips()).toEqual(['beta', 'alpha']);
    fireEvent.change(input(), { target: { value: 'alp' } });
    fireEvent.keyDown(input(), { key: 'Escape' });
    expect(input().getAttribute('aria-expanded')).toBe('false');
    expect(input().value).toBe('alp');
  });

  it('opens the full list on ArrowDown with an empty draft; clicking an option adds it', () => {
    render(<Harness />);
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    fireEvent.mouseDown(screen.getByRole('option', { name: /beta/ }));
    expect(chips()).toEqual(['beta']);
  });

  it('Backspace on an empty draft removes the last chip; with text it does not', () => {
    render(<Harness initial={['a', 'b']} />);
    fireEvent.change(input(), { target: { value: 'x' } });
    fireEvent.keyDown(input(), { key: 'Backspace' });
    expect(chips()).toEqual(['a', 'b']);
    fireEvent.change(input(), { target: { value: '' } });
    fireEvent.keyDown(input(), { key: 'Backspace' });
    expect(chips()).toEqual(['a']);
  });

  it('commas and newlines commit tokens; blur commits the draft', () => {
    render(<Harness />);
    fireEvent.change(input(), { target: { value: 'one, two,thr' } });
    expect(chips()).toEqual(['one', 'two']);
    expect(input().value).toBe('thr');
    fireEvent.blur(input());
    expect(chips()).toEqual(['one', 'two', 'thr']);
    fireEvent.blur(input());
    expect(chips()).toHaveLength(3);
  });

  it('refuses entries the validator rejects and entries beyond the cap, with an alert', () => {
    render(<Harness validateEntry={(e) => (e.includes('*') ? 'no globs' : undefined)} maxEntries={1} />);
    fireEvent.change(input(), { target: { value: 'a*' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(screen.getByTestId('allowlist-error').textContent).toBe('no globs');
    expect(chips()).toEqual([]);
    expect(input().value).toBe('a*');
    fireEvent.change(input(), { target: { value: 'ok' } });
    expect(screen.queryByTestId('allowlist-error')).toBeNull();
    fireEvent.keyDown(input(), { key: 'Enter' });
    fireEvent.change(input(), { target: { value: 'two' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(screen.getByTestId('allowlist-error').textContent).toBe('At most 1 entries.');
    expect(chips()).toEqual(['ok']);
  });

  it('marks flagged chips by state and announces a loading or unavailable suggestion source', () => {
    const { rerender } = render(
      <Harness initial={['a', 'b', 'c', 'd']} suggestionsStatus="loading"
        entryState={(e) => (e === 'a' ? { kind: 'missing' } : e === 'b' ? { kind: 'ambiguous', matches: ['x', 'y'] } : e === 'c' ? { kind: 'unavailable' } : { kind: 'ok' })} />
    );
    expect(screen.getAllByTestId('allowlist-chip').map((c) => c.getAttribute('data-state'))).toEqual(['missing', 'ambiguous', 'unavailable', 'ok']);
    expect(screen.getByLabelText('Not installed')).toBeTruthy();
    expect(screen.getByLabelText('Matches several sources')).toBeTruthy();
    expect(screen.getByLabelText('Unavailable')).toBeTruthy();
    expect(screen.getByTestId('allowlist-suggestions-status').textContent).toContain('Loading');
    rerender(<Harness initial={['a']} suggestionsStatus="unavailable" />);
    expect(screen.getByTestId('allowlist-suggestions-status').textContent).toContain('unavailable');
  });

  it('shows the no-match row, still allowing a typed name', () => {
    render(<Harness />);
    fireEvent.change(input(), { target: { value: 'zzz' } });
    expect(screen.getByTestId('allowlist-suggest').textContent).toContain('Enter adds "zzz" anyway');
  });

  it('comma-text twin parses and serialises like the legacy text input', () => {
    const spy = vi.fn();
    render(<Harness commaTextLabel="Twin" initial={['a']} spy={spy} />);
    const twin = screen.getByLabelText('Twin') as HTMLInputElement;
    expect(twin.value).toBe('a');
    fireEvent.change(twin, { target: { value: 'x, plug:y ,\n:z,,' } });
    expect(spy).toHaveBeenLastCalledWith(['x', 'plug:y', ':z']);
    expect(parseAllowlistText(' , ')).toEqual([]);
  });

  it('renders the warnings slot', () => {
    render(<Harness><p>slot content</p></Harness>);
    expect(screen.getByText('slot content')).toBeTruthy();
  });
});
