// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/native-capabilities.js', () => ({ nativeCapabilities: async () => ({ skills: [], commands: [], diagnostics: [] }) }));
const mocks = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock('../../lib/product-client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/product-client.js')>();
  return {
    ...actual,
    product: { ...actual.product, harness: { ...actual.product.harness, descriptors: async () => [] }, personas: { ...actual.product.personas, save: mocks.save } }
  };
});

import { PersonaEditor, SKILLS_FILTER_NOTICE, SKILLS_LEAN_NOTICE } from '../PersonaEditor.js';

const edit = (persona: Parameters<typeof PersonaEditor>[0]['persona']) =>
  render(<PersonaEditor persona={persona} mode="edit" onClose={() => {}} />);
const view = (persona: Parameters<typeof PersonaEditor>[0]['persona']) =>
  render(<PersonaEditor persona={persona} mode="view" onClose={() => {}} />);

const clickSave = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
  return mocks.save.mock.calls[0][0];
};

beforeEach(() => {
  (globalThis as any).CSS ??= { escape: (v: string) => v };
  Element.prototype.scrollIntoView ??= () => {};
  mocks.save.mockReset();
  mocks.save.mockImplementation(async (input: { name: string }) => ({ id: 'x', source: 'user', ...input }));
});
afterEach(cleanup);

describe('PersonaEditor skills allowlist', () => {
  it('leaves skills unset (unrestricted) when untouched', async () => {
    edit({ id: 'n', name: 'Neutral', source: 'user' });
    expect((await clickSave()).skills).toBeUndefined();
  });

  it('restricting with no entries saves an empty list, distinct from unset', async () => {
    edit({ id: 'n', name: 'Neutral', source: 'user' });
    fireEvent.click(screen.getByLabelText('Restrict skills'));
    expect((await clickSave()).skills).toEqual([]);
  });

  it('saves the parsed list and shows both advisory notices', async () => {
    edit({ id: 'n', name: 'Neutral', source: 'user' });
    fireEvent.click(screen.getByLabelText('Restrict skills'));
    fireEvent.change(screen.getByLabelText('Allowed skills'), { target: { value: 'review, plug:fmt, :lint' } });
    expect(screen.getByText(SKILLS_FILTER_NOTICE)).toBeTruthy();
    expect(screen.getByTestId('persona-skills-lean-notice').textContent).toBe(SKILLS_LEAN_NOTICE);
    expect((await clickSave()).skills).toEqual(['review', 'plug:fmt', ':lint']);
  });

  it('unchecking restriction clears a saved list', async () => {
    edit({ id: 'c', name: 'Claude', source: 'user', skills: ['review'] });
    expect((screen.getByLabelText('Allowed skills') as HTMLInputElement).value).toBe('review');
    fireEvent.click(screen.getByLabelText('Restrict skills'));
    expect((await clickSave()).skills).toBeUndefined();
  });

  it('shows the built-in default hint for a restricted built-in', () => {
    edit({ id: 'builtin:reviewer', name: 'Code Reviewer', source: 'builtin', skills: [] });
    expect(screen.getByText(/restricted by default/)).toBeTruthy();
  });

  it('detail view lists restricted skills and the empty case', () => {
    view({ id: 'c', name: 'Claude', source: 'user', skills: ['a', 'b'] });
    expect(screen.getByTestId('persona-skills-detail').textContent).toContain('a, b');
    cleanup();
    view({ id: 'c', name: 'Claude', source: 'user', skills: [] });
    expect(screen.getByTestId('persona-skills-detail').textContent).toContain('No skills beyond zcc-inbox');
  });

  it('detail view hides the section for an unrestricted persona', () => {
    view({ id: 'c', name: 'Claude', source: 'user' });
    expect(screen.queryByTestId('persona-skills-detail')).toBeNull();
  });
});
