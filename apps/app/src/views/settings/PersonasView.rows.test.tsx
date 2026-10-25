// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const scope = vi.hoisted(() => ({ projectId: null as string | null }));
const storeState = vi.hoisted(() => ({ loading: false, empty: false }));

vi.mock('../../lib/product-client.js', () => ({ product: { personas: { delete: vi.fn() } } }));
vi.mock('@/store', () => ({
  usePersonas: (selector: (s: { personas: unknown[]; loading: boolean }) => unknown) =>
    selector({
      personas: storeState.empty ? [] : [
        { id: 'user:zebra', name: 'Zebra 10', description: 'Last', source: 'user' },
        { id: 'builtin:reviewer', name: 'Reviewer', description: 'Reviews code', source: 'builtin' },
        { id: 'user:alpha-10', name: 'Alpha 10', description: 'Ten', source: 'user' },
        { id: 'user:accent', name: 'Álpha 1', description: 'Accent', source: 'user' },
        { id: 'user:alpha-2', name: 'alpha 2', description: 'Two', source: 'user' },
        { id: 'user:planner', name: 'Planner', description: 'Plans', source: 'user' },
        { id: 'user:tie-z', name: 'Same', description: 'Tie z', source: 'user' },
        { id: 'user:tie-a', name: 'Same', description: 'Tie a', source: 'user' },
        { id: 'project:a', name: 'Project A', description: 'In scope', source: { projectId: 'project-a', projectName: 'A' } },
        { id: 'project:b', name: 'Project B', description: 'Out of scope', source: { projectId: 'project-b', projectName: 'B' } }
      ],
      loading: storeState.loading
    }),
  useUi: (selector: (s: { pushToast: () => void }) => unknown) => selector({ pushToast: () => undefined })
}));
vi.mock('@/lib/windowScope', () => ({ getScopedProjectId: () => scope.projectId }));
vi.mock('@/components/PersonaEditor', () => ({
  PersonaEditor: () => null,
  RevealPersonasButton: () => null
}));

import { PersonasView } from './PersonasView';

afterEach(() => {
  storeState.loading = false;
  storeState.empty = false;
  scope.projectId = null;
  cleanup();
});

describe('PersonasView settings-search targets', () => {
  it('tags each persona row with personas.persona.<id>', () => {
    const { container } = render(<PersonasView />);
    expect(container.querySelector('li[data-settings-target="personas.persona.builtin:reviewer"]')).not.toBeNull();
    expect(container.querySelector('li[data-settings-target="personas.persona.user:planner"]')).not.toBeNull();
  });
});

describe('PersonasView catalogue order', () => {
  it('sorts rendered rows after filters while keeping counts based on scoped raw personas', () => {
    const { container } = render(<PersonasView />);

    expect(Array.from(container.querySelectorAll('.skills-row-name')).map((node) => node.textContent)).toEqual([
      'Álpha 1', 'alpha 2', 'Alpha 10', 'Planner', 'Project A', 'Project B', 'Reviewer', 'Same', 'Same', 'Zebra 10'
    ]);
    expect(Array.from(container.querySelectorAll('.skills-filter-count')).map((node) => node.textContent)).toEqual([
      '10', '1', '7', '2', '0'
    ]);

    fireEvent.click(screen.getByRole('tab', { name: /User 7/ }));
    expect(Array.from(container.querySelectorAll('.skills-row-name')).map((node) => node.textContent)).toEqual([
      'Álpha 1', 'alpha 2', 'Alpha 10', 'Planner', 'Same', 'Same', 'Zebra 10'
    ]);
    expect(Array.from(container.querySelectorAll('.skills-row')).map((node) => node.getAttribute('data-settings-target'))).toContain('personas.persona.user:tie-a');

    fireEvent.change(screen.getByRole('textbox', { name: 'Search personas' }), { target: { value: 'same' } });
    expect(Array.from(container.querySelectorAll('.skills-row')).map((node) => node.getAttribute('data-settings-target'))).toEqual([
      'personas.persona.user:tie-a', 'personas.persona.user:tie-z'
    ]);
  });

  it('keeps only current project records in a scoped window', () => {
    scope.projectId = 'project-a';
    const { container } = render(<PersonasView />);

    expect(container.querySelector('[data-settings-target="personas.persona.project:a"]')).not.toBeNull();
    expect(container.querySelector('[data-settings-target="personas.persona.project:b"]')).toBeNull();
    expect(screen.getByRole('tab', { name: /All 9/ })).toBeDefined();
    expect(screen.getByRole('tab', { name: /Project 1/ })).toBeDefined();
  });

  it('shows a loading stencil while personas load', () => {
    storeState.loading = true;
    const { container } = render(<PersonasView />);
    expect(container.querySelector('.skills-row')).toBeNull();
    expect(screen.queryByText('No matches')).toBeNull();
  });

  it('distinguishes an empty catalogue from a search with no matches', () => {
    fireEvent.change(render(<PersonasView />).container.ownerDocument.querySelector('input[aria-label="Search personas"]')!, { target: { value: 'zzzz-none' } });
    expect(screen.getByText('No matches')).toBeDefined();
    cleanup();
    storeState.empty = true;
    render(<PersonasView />);
    expect(screen.getByText('No personas found')).toBeDefined();
  });
});
