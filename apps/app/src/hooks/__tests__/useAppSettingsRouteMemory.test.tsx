import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getRememberedAppRoutePath,
  resetAppSettingsRouteMemory,
  useAppSettingsRouteMemory
} from '../useAppSettingsRouteMemory.js';

function Probe({ onPath }: { onPath: (path: string) => void }) {
  const memory = useAppSettingsRouteMemory();
  onPath(memory.projectBackRoutePath);
  return null;
}

describe('useAppSettingsRouteMemory', () => {
  afterEach(() => {
    resetAppSettingsRouteMemory();
  });

  it('keeps the last non-project path after the rail remounts on a project URL', () => {
    let path = '';
    renderToStaticMarkup(
      <MemoryRouter initialEntries={['/agents']}>
        <Probe
          onPath={(next) => {
            path = next;
          }}
        />
      </MemoryRouter>
    );
    expect(path).toBe('/agents');

    renderToStaticMarkup(
      <MemoryRouter initialEntries={['/projects/p1/feed']}>
        <Probe
          onPath={(next) => {
            path = next;
          }}
        />
      </MemoryRouter>
    );
    expect(path).toBe('/agents');
  });

  it('falls back to Agents when the first visited route is a project', () => {
    let path = '';
    renderToStaticMarkup(
      <MemoryRouter initialEntries={['/projects/p1']}>
        <Probe
          onPath={(next) => {
            path = next;
          }}
        />
      </MemoryRouter>
    );
    expect(path).toBe('/agents');
  });

  it('gives callers outside React the Settings "Back to app" path', () => {
    const visit = (path: string) =>
      renderToStaticMarkup(
        <MemoryRouter initialEntries={[path]}>
          <Probe onPath={() => {}} />
        </MemoryRouter>
      );
    expect(getRememberedAppRoutePath()).toBe('/');
    visit('/inbox');
    visit('/settings/terminal');
    expect(getRememberedAppRoutePath()).toBe('/inbox');
    // A project route never comes back from global Settings: Agents instead.
    visit('/projects/p1/settings');
    visit('/settings');
    expect(getRememberedAppRoutePath()).toBe('/agents');
  });
});
