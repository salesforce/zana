// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Save payload for the Reasoning effort picker (#584): a chosen level is sent,
// 'default' and a non-Claude persona send undefined.
const mocks = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock('../../lib/product-client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/product-client.js')>();
  return {
    ...actual,
    product: { ...actual.product, harness: { ...actual.product.harness, descriptors: async () => [] }, personas: { ...actual.product.personas, save: mocks.save } }
  };
});

import { PersonaEditor } from '../PersonaEditor.js';

const open = (persona: Parameters<typeof PersonaEditor>[0]['persona']) =>
  render(<PersonaEditor persona={persona} mode="edit" onClose={() => {}} />);

const pick = (label: string) => {
  fireEvent.click(screen.getByRole('button', { name: 'Reasoning effort' }));
  fireEvent.click(screen.getByRole('option', { name: new RegExp(label) }));
};

const clickSave = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
  return mocks.save.mock.calls[0][0];
};

beforeEach(() => {
  // jsdom has no CSS.escape and the picklist scrolls the active option into view.
  (globalThis as any).CSS ??= { escape: (v: string) => v };
  Element.prototype.scrollIntoView ??= () => {};
  mocks.save.mockReset();
  mocks.save.mockImplementation(async (input: { name: string }) => ({ id: 'x', source: 'user', ...input }));
});
afterEach(cleanup);

describe('PersonaEditor reasoning effort save payload (#584)', () => {
  it('sends the chosen level', async () => {
    open({ id: 'n', name: 'Neutral', source: 'user' });
    pick('Extra-high');
    expect((await clickSave()).reasoningLevel).toBe('xhigh');
  });

  it('sends the saved level unchanged when untouched on a Claude persona', async () => {
    open({ id: 'c', name: 'Claude', source: 'user', baseProfile: 'claude', reasoningLevel: 'max' });
    expect((await clickSave()).reasoningLevel).toBe('max');
  });

  it('sends undefined after resetting to the harness default', async () => {
    open({ id: 'n', name: 'Neutral', source: 'user', reasoningLevel: 'high' });
    pick('Use harness default');
    expect((await clickSave()).reasoningLevel).toBeUndefined();
  });

  it('sends undefined when no level was ever set', async () => {
    open({ id: 'n', name: 'Neutral', source: 'user' });
    expect((await clickSave()).reasoningLevel).toBeUndefined();
  });

  it('keeps the level for a claude-resume persona', async () => {
    open({ id: 'r', name: 'Resume', source: 'user', baseProfile: 'claude-resume', reasoningLevel: 'low' });
    expect((await clickSave()).reasoningLevel).toBe('low');
  });

  it('drops a stale level for a persona pinned to a non-Claude harness', async () => {
    open({ id: 'o', name: 'Codex', source: 'user', baseProfile: 'codex', reasoningLevel: 'high' });
    expect((await clickSave()).reasoningLevel).toBeUndefined();
  });
});

describe('PersonaEditor reasoning effort details view (#584)', () => {
  it('shows the same label as the picker, not the raw value', () => {
    const { container } = render(
      <PersonaEditor persona={{ id: 'v', name: 'V', source: 'builtin', reasoningLevel: 'xhigh' }} mode="view" onClose={() => {}} />
    );
    expect(container.textContent).toContain('Extra-high');
    expect(container.textContent).not.toContain('xhigh');
  });
});
