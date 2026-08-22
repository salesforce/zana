import { describe, expect, it } from 'vitest';
import {
  INITIAL_STORED_ROUTE_MEMORY,
  nextStoredRouteMemory,
  visibleRouteMemory
} from '../route-memory.js';

const loc = (pathname: string) => ({ pathname, search: '', hash: '' });

describe('route memory', () => {
  it('remembers last core-app path for Extensions back', () => {
    let stored = INITIAL_STORED_ROUTE_MEMORY;
    stored = nextStoredRouteMemory(stored, loc('/inbox'));
    stored = nextStoredRouteMemory(stored, loc('/extensions/plugins'));
    const visible = visibleRouteMemory(stored, loc('/extensions/plugins'));
    expect(visible.toolsBackRoutePath).toBe('/inbox');
    expect(visible.toolsRoutePath).toBe('/extensions/plugins');
  });

  it('remembers last settings path for re-entry', () => {
    let stored = INITIAL_STORED_ROUTE_MEMORY;
    stored = nextStoredRouteMemory(stored, loc('/settings/terminal'));
    stored = nextStoredRouteMemory(stored, loc('/'));
    const visible = visibleRouteMemory(stored, loc('/'));
    expect(visible.settingsRoutePath).toBe('/settings/terminal');
    expect(visible.appRoutePath).toBe('/');
  });

  it('remembers last non-project path for project-rail Back', () => {
    let stored = INITIAL_STORED_ROUTE_MEMORY;
    stored = nextStoredRouteMemory(stored, loc('/agents'));
    stored = nextStoredRouteMemory(stored, loc('/projects/p1'));
    stored = nextStoredRouteMemory(stored, loc('/projects/p1/terminals'));
    const visible = visibleRouteMemory(stored, loc('/projects/p1/terminals'));
    expect(visible.projectBackRoutePath).toBe('/agents');
  });

  it('keeps search and hash on remembered paths', () => {
    let stored = INITIAL_STORED_ROUTE_MEMORY;
    stored = nextStoredRouteMemory(stored, {
      pathname: '/settings/global',
      search: '?x=1',
      hash: '#appearance'
    });
    const onSettings = visibleRouteMemory(stored, {
      pathname: '/settings/global',
      search: '?x=1',
      hash: '#appearance'
    });
    expect(onSettings.settingsRoutePath).toBe('/settings/global?x=1#appearance');
    expect(onSettings.appRoutePath).toBe('/');

    stored = nextStoredRouteMemory(stored, loc('/extensions/skills'));
    const onTools = visibleRouteMemory(stored, loc('/extensions/skills'));
    expect(onTools.toolsRoutePath).toBe('/extensions/skills');
    expect(onTools.appRoutePath).toBe('/extensions/skills');
    expect(onTools.toolsBackRoutePath).toBe('/');
  });

  it('treats settings as its own shell kind and does not clobber last app path', () => {
    let stored = nextStoredRouteMemory(INITIAL_STORED_ROUTE_MEMORY, loc('/inbox'));
    stored = nextStoredRouteMemory(stored, loc('/settings'));
    const visible = visibleRouteMemory(stored, loc('/settings'));
    expect(visible.appRoutePath).toBe('/inbox');
    expect(visible.settingsRoutePath).toBe('/settings');
    expect(visible.toolsBackRoutePath).toBe('/inbox');
  });
});
