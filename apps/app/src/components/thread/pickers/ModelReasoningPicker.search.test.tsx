/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ModelReasoningPicker } from './ModelReasoningPicker.js';

afterEach(() => {
  cleanup();
});

describe('ModelReasoningPicker search', () => {
  it('filters slash-separated ids by the typed query', () => {
    const catalog = [
      { value: 'openai/gpt-5', label: 'openai/gpt-5' },
      { value: 'openrouter/openai/gpt-5', label: 'openrouter/openai/gpt-5' },
      { value: 'openrouter/rekaai/reka-flash-3', label: 'openrouter/rekaai/reka-flash-3' },
      { value: 'openrouter/relace/relace-apply-3', label: 'openrouter/relace/relace-apply-3' },
      { value: 'openrouter/relace/relace-search', label: 'openrouter/relace/relace-search' },
      { value: 'openrouter/sao10k/l3-lunaris-8b', label: 'openrouter/sao10k/l3-lunaris-8b' }
    ];
    render(
      <ModelReasoningPicker
        providerOptions={[{ value: 'pi', label: 'Pi' }]}
        selectedProviderId="pi"
        modelValue="openrouter/rekaai/reka-flash-3"
        modelOptions={catalog}
        onModelChange={() => undefined}
      />
    );
    fireEvent.click(screen.getByTestId('model-reasoning-picker-trigger'));
    fireEvent.change(screen.getByLabelText('Search models'), { target: { value: 'openai' } });
    expect(screen.getByTestId('model-reasoning-model-openai/gpt-5')).toBeTruthy();
    expect(screen.getByTestId('model-reasoning-model-openrouter/openai/gpt-5')).toBeTruthy();
    expect(screen.queryByTestId('model-reasoning-model-openrouter/rekaai/reka-flash-3')).toBeNull();
    expect(screen.queryByTestId('model-reasoning-model-openrouter/relace/relace-apply-3')).toBeNull();
  });
});
