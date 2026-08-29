import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect, vi } from 'vitest';
import { CheckboxField, SettingsActionRow, tokenizeArgsLine } from '../FormFields.js';

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
