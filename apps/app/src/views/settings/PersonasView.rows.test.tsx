// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/product-client.js', () => ({ product: { personas: { delete: vi.fn() } } }));
vi.mock('@/store', () => ({
  usePersonas: (selector: (s: { personas: unknown[]; loading: boolean }) => unknown) =>
    selector({
      personas: [
        { id: 'builtin:reviewer', name: 'Reviewer', description: 'Reviews code', source: 'builtin' },
        { id: 'user:planner', name: 'Planner', description: 'Plans', source: 'user' }
      ],
      loading: false
    }),
  useUi: (selector: (s: { pushToast: () => void }) => unknown) => selector({ pushToast: () => undefined })
}));
vi.mock('@/lib/windowScope', () => ({ getScopedProjectId: () => null }));
vi.mock('@/components/PersonaEditor', () => ({
  PersonaEditor: () => null,
  RevealPersonasButton: () => null
}));

import { PersonasView } from './PersonasView';

afterEach(cleanup);

describe('PersonasView settings-search targets', () => {
  it('tags each persona row with personas.persona.<id>', () => {
    const { container } = render(<PersonasView />);
    expect(container.querySelector('li[data-settings-target="personas.persona.builtin:reviewer"]')).not.toBeNull();
    expect(container.querySelector('li[data-settings-target="personas.persona.user:planner"]')).not.toBeNull();
  });
});
