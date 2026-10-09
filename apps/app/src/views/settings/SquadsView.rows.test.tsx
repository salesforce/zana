// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/product-client.js', () => ({ product: { teams: {} } }));
vi.mock('@/store', () => ({
  useTeams: (selector: (s: { teams: unknown[]; loading: boolean }) => unknown) =>
    selector({
      teams: [
        { id: 'builtin:core', name: 'Core squad', description: 'Core', source: 'builtin', slots: [] },
        { id: 'user:mine', name: 'My squad', description: 'Mine', source: 'user', slots: [] }
      ],
      loading: false
    }),
  useData: (selector: (s: { projects: unknown[] }) => unknown) => selector({ projects: [] }),
  useUi: (selector: (s: { pushToast: () => void }) => unknown) => selector({ pushToast: () => undefined }),
  usePersonas: (selector: (s: { personas: unknown[] }) => unknown) => selector({ personas: [] })
}));
vi.mock('@/lib/windowScope', () => ({ getScopedProjectId: () => null }));
vi.mock('@/components/SquadEditor', () => ({ SquadEditor: () => null }));

import { SquadsView } from './SquadsView';

afterEach(cleanup);

describe('SquadsView settings-search targets', () => {
  it('tags each squad row with squads.squad.<id>', () => {
    const { container } = render(<SquadsView />);
    expect(container.querySelector('li[data-settings-target="squads.squad.builtin:core"]')).not.toBeNull();
    expect(container.querySelector('li[data-settings-target="squads.squad.user:mine"]')).not.toBeNull();
  });
});
