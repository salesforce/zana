// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PromptsView } from './PromptsView.js';
import { entries } from '../../lib/settings-search/entries/prompts.js';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  availableProviders: vi.fn(async () => ['claude-cli']),
  onChanged: vi.fn(() => () => undefined)
}));
vi.mock('../../lib/product-client.js', () => ({
  product: { llmPrompts: { list: mocks.list, availableProviders: mocks.availableProviders, onChanged: mocks.onChanged, save: vi.fn(), delete: vi.fn(), test: vi.fn() } }
}));

afterEach(cleanup);

describe('PromptsView settings-search targets', () => {
  it('renders every indexed prompts entry once a prompt is selected', async () => {
    mocks.list.mockResolvedValue([
      { id: 'builtin:tab-namer', label: 'Tab namer', source: 'builtin', provider: 'claude-cli', model: 'haiku', systemPrompt: 's', userTemplate: 'Name: {{prompt}}' }
    ]);
    const { container } = render(<PromptsView />);
    await waitFor(() => expect(screen.getByText('System prompt')).toBeTruthy());
    const rendered = new Set([...container.querySelectorAll('[data-settings-target]')].map((e) => e.getAttribute('data-settings-target')));
    for (const e of entries) expect(rendered, e.id).toContain(e.id);
  });

  it('renders the intro target and the no-placeholder test panel', async () => {
    mocks.list.mockResolvedValue([
      { id: 'user:x', label: 'X', source: 'user', provider: 'claude-cli', systemPrompt: 's', userTemplate: 'plain' }
    ]);
    const { container } = render(<PromptsView />);
    await waitFor(() => expect(container.querySelector('[data-settings-target="prompts.test"]')).toBeTruthy());
    expect(container.textContent).toContain('to fill');
    expect(container.querySelector('[data-settings-target="prompts.intro"]')).toBeTruthy();
    expect(container.querySelector('[data-settings-target="prompts.test"]')).toBeTruthy();
  });
});
