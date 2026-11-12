// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock('../../lib/native-capabilities.js', () => ({
  nativeCapabilities: async () => ({ skills: [{ name: 'review' }, { name: 'fmt' }], commands: [], diagnostics: [] })
}));
vi.mock('../../lib/product-client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/product-client.js')>();
  return {
    ...actual,
    product: { ...actual.product, harness: { ...actual.product.harness, descriptors: async () => [] }, personas: { ...actual.product.personas, save: mocks.save } }
  };
});

import { PersonaEditor } from '../PersonaEditor.js';
import { parseAllowlistText } from '../AllowlistField.js';

const edit = (skills?: string[]) =>
  render(<PersonaEditor persona={{ id: 'p', name: 'P', source: 'user', ...(skills ? { skills } : {}) }} mode="edit" onClose={() => {}} />);
const saved = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
  return mocks.save.mock.calls[0][0].skills;
};

beforeEach(() => {
  (globalThis as any).CSS ??= { escape: (v: string) => v };
  Element.prototype.scrollIntoView ??= () => {};
  mocks.save.mockReset();
  mocks.save.mockImplementation(async (input: { name: string }) => ({ id: 'x', source: 'user', ...input }));
});
afterEach(cleanup);

describe('PersonaEditor skills round trip on the shared AllowlistField', () => {
  it('absent stays absent', async () => {
    edit();
    expect(screen.queryByLabelText('Allowed skills')).toBeNull();
    expect(await saved()).toBeUndefined();
  });

  it('[] loads restricted-empty with the fixed chip and saves []', async () => {
    edit([]);
    expect((screen.getByLabelText('Allowed skills') as HTMLInputElement).value).toBe('');
    expect(screen.getByTestId('allowlist-fixed-chip').textContent).toContain('zcc-inbox');
    expect(await saved()).toEqual([]);
  });

  it('a list with colon and uninstalled entries renders as chips and saves unchanged', async () => {
    edit(['review', 'plug:fmt', ':lint', 'ghost']);
    await waitFor(() => expect(screen.getAllByTestId('allowlist-chip').some((c) => c.getAttribute('data-state') === 'missing')).toBe(true));
    const chips = screen.getAllByTestId('allowlist-chip');
    expect(chips.map((c) => c.querySelector('.settings-chip-text')?.textContent)).toEqual(['review', 'plug:fmt', ':lint', 'ghost']);
    expect(chips.map((c) => c.getAttribute('data-state'))).toEqual(['ok', 'ok', 'missing', 'missing']);
    expect(await saved()).toEqual(['review', 'plug:fmt', ':lint', 'ghost']);
  });

  it('chips emit the same array as the legacy comma text for the same input', async () => {
    const text = 'review, plug:fmt ,\n:lint, , dup, dup';
    edit([]);
    fireEvent.change(screen.getByLabelText('Allowed skills'), { target: { value: text } });
    expect(await saved()).toEqual(text.split(/[\n,]/).map((s) => s.trim()).filter(Boolean));
    expect(parseAllowlistText(text)).toEqual(['review', 'plug:fmt', ':lint', 'dup', 'dup']);
  });

  it('typing chips yields the same array as typing the comma text', async () => {
    edit([]);
    const input = screen.getByLabelText('Add allowed skill');
    for (const v of ['review', 'plug:fmt', ':lint']) {
      fireEvent.change(input, { target: { value: v } });
      fireEvent.keyDown(input, { key: 'Enter' });
    }
    expect(await saved()).toEqual(parseAllowlistText('review, plug:fmt, :lint'));
  });

  it('suggests installed skills and the chip text mirrors back into the comma twin', async () => {
    edit(['review']);
    const input = screen.getByLabelText('Add allowed skill');
    fireEvent.change(input, { target: { value: 'f' } });
    await waitFor(() => expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['fmt']));
    fireEvent.mouseDown(screen.getByRole('option'));
    expect((screen.getByLabelText('Allowed skills') as HTMLInputElement).value).toBe('review, fmt');
  });
});
