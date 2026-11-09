// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ save: vi.fn(), caps: vi.fn() }));
vi.mock('../../lib/native-capabilities.js', () => ({ nativeCapabilities: mocks.caps }));
vi.mock('../../lib/product-client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/product-client.js')>();
  return {
    ...actual,
    product: { ...actual.product, harness: { ...actual.product.harness, descriptors: async () => [] }, personas: { ...actual.product.personas, save: mocks.save } }
  };
});

import { PersonaEditor } from '../PersonaEditor.js';

const WARN = 'persona-skills-uninstalled-warning';
const listing = (skills: Array<Record<string, unknown>>) => ({ skills, commands: [], diagnostics: [] });
const edit = (skills?: string[]) =>
  render(<PersonaEditor persona={{ id: 'p', name: 'P', source: 'user', ...(skills ? { skills } : {}) }} mode="edit" onClose={() => {}} />);

beforeEach(() => {
  (globalThis as any).CSS ??= { escape: (v: string) => v };
  Element.prototype.scrollIntoView ??= () => {};
  mocks.save.mockReset();
  mocks.save.mockImplementation(async (input: { name: string }) => ({ id: 'x', source: 'user', ...input }));
  mocks.caps.mockReset();
});
afterEach(cleanup);

describe('PersonaEditor uninstalled skill warning', () => {
  it('warns for an allowlisted skill that is not installed, and save stays enabled', async () => {
    mocks.caps.mockResolvedValue(listing([{ name: 'review' }]));
    edit(['review', 'ghost']);
    const warn = await screen.findByTestId(WARN);
    expect(warn.textContent).toContain('ghost');
    expect(warn.textContent).not.toContain('review');
    const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    expect(mocks.save.mock.calls[0][0].skills).toEqual(['review', 'ghost']);
  });

  it('shows no warning when all allowlisted skills are installed', async () => {
    mocks.caps.mockResolvedValue(listing([{ name: 'review' }, { name: 'fmt' }]));
    edit(['review', 'plug:fmt']);
    await waitFor(() => expect(mocks.caps).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId(WARN)).toBeNull();
  });

  it('treats disabled, unavailable, and rule entries as not installed', async () => {
    mocks.caps.mockResolvedValue(listing([
      { name: 'off', enabled: false }, { name: 'gone', available: false }, { name: 'r', kind: 'rule' }
    ]));
    edit(['off', 'gone', 'r']);
    expect((await screen.findByTestId(WARN)).textContent).toContain('off, gone, r');
  });

  it('updates as the list is edited', async () => {
    mocks.caps.mockResolvedValue(listing([{ name: 'review' }]));
    edit(['review']);
    await waitFor(() => expect(mocks.caps).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText('Allowed skills'), { target: { value: 'review, nope' } });
    expect((await screen.findByTestId(WARN)).textContent).toContain('nope');
  });

  it('stays silent and does not fetch when skills are unrestricted', async () => {
    edit();
    await new Promise((r) => setTimeout(r, 0));
    expect(mocks.caps).not.toHaveBeenCalled();
    expect(screen.queryByTestId(WARN)).toBeNull();
  });

  it('stays silent when the inventory is unavailable and save still works', async () => {
    mocks.caps.mockRejectedValue(new Error('offline'));
    edit(['ghost']);
    await waitFor(() => expect(mocks.caps).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId(WARN)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
  });
});
