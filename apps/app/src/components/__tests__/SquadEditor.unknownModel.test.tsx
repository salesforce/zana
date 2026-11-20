/** @vitest-environment happy-dom */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Team } from '@zana-ai/zcc-domain/product';

const state = vi.hoisted(() => ({ personas: [] as Array<Record<string, unknown>>, projects: [], pushToast: () => undefined }));
const snapshot = vi.hoisted(() => ({ value: { byProvider: {}, provisionalProviders: new Set<string>() } as unknown }));
vi.mock('../../lib/native-capabilities.js', () => ({ nativeCapabilities: vi.fn() }));
vi.mock('../../lib/product-client.js', () => ({ product: { teams: { save: vi.fn(), delete: vi.fn() } } }));
vi.mock('../ImprovePromptButton.js', () => ({ ImprovePromptButton: () => null }));
vi.mock('../thread/pickers/thread-model-catalog.js', () => ({
  getThreadModelCatalog: () => snapshot.value,
  subscribeThreadModelCatalog: () => () => undefined
}));
vi.mock('../../store.js', () => ({
  usePersonas: (sel: (s: unknown) => unknown) => sel(state),
  useData: (sel: (s: unknown) => unknown) => sel(state),
  useUi: (sel: (s: unknown) => unknown) => sel(state)
}));

import { SquadEditor } from '../SquadEditor.js';

const team: Team = { id: 'user:s', name: 'S', source: 'user', slots: [{ personaId: 'a', quantity: 1 }] } as Team;
const loaded = (ids: string[]) => ({
  byProvider: { pi: { models: ids.map((id) => ({ id, model: id, displayName: id })), selectedOnlyModels: [], modelLoadError: null } },
  provisionalProviders: new Set<string>()
});
afterEach(() => { cleanup(); state.personas = []; snapshot.value = { byProvider: {}, provisionalProviders: new Set() }; });

describe('SquadEditor unknown model warning', () => {
  it('warns about a persona model the loaded catalog does not list, without blocking save', () => {
    state.personas = [{ id: 'a', name: 'Alpha', baseProfile: 'pi', model: 'bogus' }];
    snapshot.value = loaded(['openai/gpt-y']);
    render(<SquadEditor team={team} mode="edit" onClose={vi.fn()} />);
    expect(screen.getByTestId('team-unknown-model-warning').textContent).toContain('Alpha (bogus)');
    expect((screen.getByRole('button', { name: /Save/ }) as HTMLButtonElement).disabled).toBe(false);
  });
  it('shows nothing for a listed model', () => {
    state.personas = [{ id: 'a', name: 'Alpha', baseProfile: 'pi', model: 'openai/gpt-y' }];
    snapshot.value = loaded(['openai/gpt-y']);
    render(<SquadEditor team={team} mode="edit" onClose={vi.fn()} />);
    expect(screen.queryByTestId('team-unknown-model-warning')).toBeNull();
  });
  it('shows nothing when the catalog has not loaded', () => {
    state.personas = [{ id: 'a', name: 'Alpha', baseProfile: 'pi', model: 'bogus' }];
    render(<SquadEditor team={team} mode="edit" onClose={vi.fn()} />);
    expect(screen.queryByTestId('team-unknown-model-warning')).toBeNull();
  });
});
