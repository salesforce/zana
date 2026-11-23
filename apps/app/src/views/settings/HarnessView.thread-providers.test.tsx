// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ThreadModelCatalogEntry } from '../../components/thread/pickers/thread-model-catalog.js';
import { HarnessModels } from './HarnessModels.js';

afterEach(cleanup);

function catalog(count: number): ThreadModelCatalogEntry {
  return {
    models: Array.from({ length: count }, (_, i) => ({
      id: `model-${i}`, model: `model-${i}`, displayName: `Model ${i}`, isDefault: i === 0,
      defaultReasoningEffort: null, supportedReasoningEfforts: []
    })),
    selectedOnlyModels: [], modelLoadError: null, lastSuccessAt: 1700000000000
  };
}

describe('Models inside a harness', () => {
  it('searches all pages by name and ID and clamps the page after a refresh', () => {
    const onReload = vi.fn();
    const view = (count: number) => <HarnessModels name="Pi" entry={catalog(count)} status="Sign in with pi" canReload onReload={onReload} />;
    const ui = render(view(27));
    expect(screen.getAllByRole('listitem')).toHaveLength(12);
    expect(screen.getByText('Provider default')).toBeTruthy();
    expect(screen.getByText(/^Last loaded:/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Next Pi models' }));
    expect(screen.getByText('13–24 of 27 models')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Previous Pi models' }));
    expect(screen.getByText('1–12 of 27 models')).toBeTruthy();
    const input = screen.getByRole('searchbox', { name: 'Search Pi models' });
    for (const query of ['model-26', 'Model 26']) {
      fireEvent.change(input, { target: { value: query } });
      expect(screen.getByText('Model 26')).toBeTruthy();
    }
    fireEvent.change(input, { target: { value: 'no such model' } });
    expect(screen.getByText('No models match your search.')).toBeTruthy();
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next Pi models' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reload models' }));
    expect(onReload).toHaveBeenCalledOnce();
    ui.rerender(view(1));
    expect(screen.getByText('Model 0')).toBeTruthy();
    ui.rerender(view(0));
    expect(screen.getByText('Sign in with pi')).toBeTruthy();
  });

  it('shows discovery errors and disables refresh without a connection', () => {
    const onReload = vi.fn();
    render(<HarnessModels name="Codex" entry={{ ...catalog(1), modelLoadErrorDetail: 'Connection lost' }}
      status="Previously loaded models" canReload={false} onReload={onReload} />);
    expect(screen.getByRole('status').textContent).toBe('Connection lost');
    fireEvent.click(screen.getByRole('button', { name: 'Reload models' }));
    expect(onReload).not.toHaveBeenCalled();
  });
});
