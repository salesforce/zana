import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NativeRolePicker } from './NativeRolePicker.js';

const options = [
  { value: 'build', name: 'build' },
  { value: 'doc-vault', name: 'doc-vault' },
  { value: 'plan', name: 'plan' }
];

describe('NativeRolePicker', () => {
  it('renders the explicitly selected role', () => {
    const html = renderToStaticMarkup(
      <NativeRolePicker value="doc-vault" options={options} onChange={() => undefined} onRefresh={() => undefined} />
    );
    expect(html).toContain('data-testid="native-role-picker-trigger"');
    expect(html).toContain('doc-vault</span>');
  });

  it('shows a neutral placeholder (never options[0]) when no role is selected', () => {
    // The regression: an existing thread has no per-thread mode source, so the
    // picker must NOT claim the first option (build) as selected — that lied
    // about the running mode. Undefined → honest neutral label.
    const html = renderToStaticMarkup(
      <NativeRolePicker value={undefined} options={options} onChange={() => undefined} onRefresh={() => undefined} />
    );
    expect(html).toContain('Agent</span>');
    expect(html).not.toContain('build</span>');
  });

  it('hides entirely when the provider advertises no modes', () => {
    const html = renderToStaticMarkup(
      <NativeRolePicker value={undefined} options={[]} onChange={() => undefined} onRefresh={() => undefined} />
    );
    expect(html).toBe('');
  });
});
