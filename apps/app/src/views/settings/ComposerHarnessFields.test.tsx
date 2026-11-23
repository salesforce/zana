// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AvailableModel } from '@zana-ai/zcc-domain/thread-runtime';
import { ComposerHarnessFields } from './ComposerHarnessFields';
import { HarnessModelPreferences } from './HarnessModelPreferences';
import { rememberedSelectionFor, rememberedProviderId } from '@/components/thread/pickers/composer-selection-preference';

const state = vi.hoisted(() => ({
  host: 'connected',
  available: true,
  error: null as string | null,
  snapshot: {} as any,
  ensureProvider: vi.fn(), refresh: vi.fn()
}));
vi.mock('@/hooks/useHosts', () => ({ useHosts: () => [], primaryHost: () => ({ id: 'mac', status: state.host }) }));
vi.mock('@/hooks/useRegisteredThreadProviders', () => ({ useRegisteredThreadProviders: () => ({
  providers: [{ id: 'plug', displayName: 'Plugin agent', available: state.available }], loading: false, error: state.error
}) }));
vi.mock('@/components/thread/pickers/thread-model-catalog', () => {
  const catalog = { subscribe: () => () => {}, getSnapshot: () => state.snapshot, ensureProvider: state.ensureProvider, refresh: state.refresh };
  return { threadModelCatalogForHost: () => catalog };
});

function model(name: string, efforts: Array<'low' | 'medium' | 'high'>): AvailableModel {
  return { id: name, model: name, displayName: name, isDefault: false, description: '',
    defaultReasoningEffort: efforts[0] ?? 'medium', supportedReasoningEfforts: efforts.map(reasoningEffort => ({ reasoningEffort, description: '' })) };
}
const models = [model('Quick', ['low']), model('Deep', ['medium', 'high']), model('Direct', [])];
function view(value: string | null = 'plug') {
  return <ComposerHarnessFields value={value} onChange={vi.fn().mockResolvedValue(undefined)} />;
}
beforeEach(() => {
  localStorage.clear(); vi.clearAllMocks();
  state.host = 'connected'; state.available = true; state.error = null;
  state.snapshot = { byProvider: { plug: { models } }, inflight: new Set(), provisionalProviders: new Set() };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('shares the model and supported effort with the harness page, leaving the CLI provider choice independent', () => {
  state.snapshot.byProvider.plug.selectedOnlyModels = [model('Legacy', ['low'])];
  const first = render(view());
  expect(state.ensureProvider).toHaveBeenCalledWith('plug');
  fireEvent.click(screen.getByRole('button', { name: 'Model', exact: true }));
  expect(screen.getByRole('option', { name: 'Legacy' })).toBeTruthy();
  fireEvent.click(screen.getByRole('option', { name: 'Deep' }));
  expect(rememberedSelectionFor('plug')).toEqual({ model: 'Deep', reasoningLevel: 'medium' });
  fireEvent.click(screen.getByRole('button', { name: 'Thinking effort' }));
  fireEvent.click(screen.getByRole('option', { name: 'High' }));
  first.unmount();
  render(<HarnessModelPreferences providerId="plug" models={models} />);
  expect(screen.getByRole('button', { name: 'Thinking effort' }).textContent).toContain('High');
  expect(rememberedProviderId()).toBeUndefined();
  fireEvent.click(screen.getByRole('button', { name: 'Model', exact: true }));
  fireEvent.click(screen.getByRole('option', { name: 'Direct' }));
  expect(screen.queryByRole('button', { name: 'Thinking effort' })).toBeNull();
});
it('hides unavailable and stale settings, reports discovery errors and reloads the active provider', () => {
  state.host = 'disconnected';
  const widget = render(view());
  expect(screen.getByRole('status').textContent).toContain('Connect the machine');
  expect(state.ensureProvider).not.toHaveBeenCalled();
  state.host = 'connected'; state.snapshot.inflight.add('plug'); delete state.snapshot.byProvider.plug; widget.rerender(view());
  expect(screen.getByRole('status').textContent).toContain('Loading models');
  state.snapshot.inflight.clear(); state.snapshot.byProvider.plug = { models, modelLoadError: 'timeout', modelLoadErrorDetail: 'Timed out' }; widget.rerender(view());
  expect(screen.getByRole('status').textContent).toContain('Timed out');
  fireEvent.click(screen.getByRole('button', { name: 'Reload models' })); expect(state.refresh).toHaveBeenCalledWith('plug');
  state.snapshot.byProvider.plug = { models }; state.snapshot.provisionalProviders.add('plug'); widget.rerender(view());
  expect(screen.queryByRole('button', { name: 'Model', exact: true })).toBeNull();
  state.error = 'Registry unavailable'; state.available = false; widget.rerender(view());
  expect(screen.getByRole('alert').textContent).toBe('Registry unavailable');
  widget.rerender(view(null)); expect(screen.queryByRole('status')).toBeNull();
});
it('shows an actionable failure when the model preference cannot be saved', async () => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => { throw Error('Storage full'); } });
  const widget = render(<HarnessModelPreferences providerId="plug" models={models} />);
  fireEvent.click(screen.getByRole('button', { name: 'Model', exact: true }));
  fireEvent.click(screen.getByRole('option', { name: 'Deep' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Could not save'));
  widget.rerender(<HarnessModelPreferences providerId="plug" models={[]} />);
  expect(screen.queryByRole('button')).toBeNull();
});
