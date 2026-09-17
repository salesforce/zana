import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import {
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
});
