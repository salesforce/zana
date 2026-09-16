// @vitest-environment happy-dom
import { renderToStaticMarkup } from 'react-dom/server';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { CheckboxField, ChipField, Field, Section, SettingsActionRow, TextArgsField, tokenizeArgsLine } from '../FormFields.js';

afterEach(cleanup);

describe('controls inside preference groups', () => {
  it('keeps chip entry, removal, and empty commits working inside a group', () => {
    const onChange = vi.fn();
    const view = render(<Section title="Tools"><ChipField label="Tools" help="Allowed tools" values={['read']} onChange={onChange} /></Section>);
    const input = screen.getByRole('textbox', { name: 'Add Tools' });
    fireEvent.click(screen.getByRole('group', { name: 'Tools' }));
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: 'write, search' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith(['read', 'write', 'search']);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(input, { key: 'Backspace' });
    expect(onChange).toHaveBeenLastCalledWith([]);
    fireEvent.click(screen.getByRole('button', { name: 'Remove read' }));
    expect(onChange).toHaveBeenLastCalledWith([]);
    view.rerender(<ChipField label="Tools" values={[]} placeholder="Add a tool" onChange={onChange} />);
    const empty = screen.getByPlaceholderText('Add a tool');
    fireEvent.change(empty, { target: { value: 'read' } });
    fireEvent.blur(empty);
    expect(onChange).toHaveBeenLastCalledWith(['read']);
    fireEvent.keyDown(empty, { key: 'Tab' });
  });

  it('preserves a focused argument draft across config refreshes and commits complete quoted arguments', () => {
    const onChange = vi.fn();
    const view = render(<Section title="Advanced"><TextArgsField label="Arguments" help="Extra arguments" values={['--old']} onChange={onChange} /></Section>);
    const input = screen.getByRole('textbox');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '--path "/my project"' } });
    view.rerender(<Section title="Advanced"><TextArgsField label="Arguments" values={['--external']} onChange={onChange} /></Section>);
    expect((input as HTMLInputElement).value).toBe('--path "/my project"');
    fireEvent.keyDown(input, { key: 'Tab' });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(['--path', '/my project']);
    fireEvent.change(input, { target: { value: '--verbose' } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenLastCalledWith(['--verbose']);
    view.rerender(<Section title="Advanced"><TextArgsField label="Arguments" values={['--external']} onChange={onChange} /></Section>);
    expect((input as HTMLInputElement).value).toBe('--external');
  });
});

describe('preference groups', () => {
  it('gives each section a distinct accessible heading and preserves search anchors', () => {
    render(<>
      <Section title="Appearance" anchorId="appearance"><Field label="Theme" layout="row" help="Choose a theme"><select defaultValue="light"><option>light</option></select></Field></Section>
      <Section title="Advanced" flush><Field label="Path" mono><input defaultValue="/tmp" /></Field></Section>
    </>);
    const appearance = screen.getByRole('region', { name: 'Appearance' });
    const advanced = screen.getByRole('region', { name: 'Advanced' });
    expect(appearance.id).toBe('settings-anchor-appearance');
    expect(appearance.getAttribute('aria-labelledby')).not.toBe(advanced.getAttribute('aria-labelledby'));
    expect(within(appearance).getByRole('combobox', { name: 'Theme' })).toBeTruthy();
    expect(within(advanced).getByRole('textbox', { name: 'Path' })).toBeTruthy();
  });

  it('associates switch help with its control and retains disabled behavior', () => {
    const onChange = vi.fn();
    const view = render(<Section title="Notifications" help="Choose what reaches you.">
      <CheckboxField label="Show updates" help="New updates appear in your inbox." checked={false} onChange={onChange} />
    </Section>);
    const control = screen.getByRole('switch', { name: 'Show updates' });
    expect(document.getElementById(control.getAttribute('aria-describedby')!)?.textContent).toBe('New updates appear in your inbox.');
    fireEvent.click(control);
    expect(onChange).toHaveBeenCalledWith(true);
    view.rerender(<CheckboxField label="Show updates" checked disabled onChange={onChange} />);
    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('switch').hasAttribute('aria-describedby')).toBe(false);
  });
});

/**
 * Pins the fix for "Extra args" splicing a whole `--flag value` string into
 * argv as ONE token (e.g. `claude --plugin-dir /some/path` failing with
 * `unknown option '--plugin-dir /some/path'`). "Extra args" now uses
 * `TextArgsField` — a single text box, not a chip-per-token UI — and
 * `tokenizeArgsLine` is what turns that one line into the `string[]` every
 * launch path expects, splitting on whitespace like a shell would.
 */
describe('tokenizeArgsLine', () => {
  it('splits a flag and its value into separate tokens', () => {
    expect(tokenizeArgsLine('--plugin-dir /Users/grebmann/dummy-test-plugin')).toEqual([
      '--plugin-dir',
      '/Users/grebmann/dummy-test-plugin'
    ]);
  });

  it('splits multiple space-separated flags on one line', () => {
    expect(tokenizeArgsLine('--verbose --plugin-dir /a/b --add-dir /c/d')).toEqual([
      '--verbose',
      '--plugin-dir',
      '/a/b',
      '--add-dir',
      '/c/d'
    ]);
  });

  it('keeps a quoted segment with an embedded space as one token', () => {
    expect(tokenizeArgsLine('--plugin-dir "/Users/grebmann/My Plugin"')).toEqual([
      '--plugin-dir',
      '/Users/grebmann/My Plugin'
    ]);
  });

  it('collapses repeated whitespace and ignores empty input', () => {
    expect(tokenizeArgsLine('  --plugin-dir    /a/b  ')).toEqual(['--plugin-dir', '/a/b']);
    expect(tokenizeArgsLine('   ')).toEqual([]);
  });
});

describe('CheckboxField', () => {
  it('renders a harness-style switch instead of a checkbox', () => {
    const html = renderToStaticMarkup(
      <CheckboxField
        label="Use auto mode by default"
        help="When on, new agents launch in auto."
        checked={true}
        onChange={vi.fn()}
      />
    );
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('aria-label="Use auto mode by default"');
    expect(html).toContain('opener-switch--on');
    expect(html).toContain('When on, new agents launch in auto.');
    expect(html).not.toContain('type="checkbox"');
  });

  it('disables the switch when the field is busy', () => {
    const html = renderToStaticMarkup(
      <CheckboxField label="Enabled" checked={false} disabled onChange={vi.fn()} />
    );
    expect(html).toContain('disabled=""');
    expect(html).toContain('aria-checked="false"');
    expect(html).not.toContain('opener-switch--on');
  });
});

describe('SettingsActionRow', () => {
  it('puts the label and help beside the action control', () => {
    const html = renderToStaticMarkup(
      <SettingsActionRow label="Replay walkthrough" help="Launching an agent, adding a project.">
        <button type="button" className="settings-btn">Replay</button>
      </SettingsActionRow>
    );
    expect(html).toContain('settings-field--action');
    expect(html).toContain('Replay walkthrough');
    expect(html).toContain('Launching an agent, adding a project.');
    expect(html).toContain('settings-btn');
    expect(html).toContain('Replay');
  });
});
