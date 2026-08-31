import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  MAX_CHIP_COUNTER_SCALE,
  MAX_FIXTURE_SCALE,
  annotationChipCounterScale,
  annotationNeighbors,
  panCarets,
  renderSurfaceCopy,
  spatialFixtureScale
} from './annotation.js';
import { SURFACE_GROUPS } from './surfaces.js';
import { ProductMap, SURFACE_NUMBERS } from './product-map.js';
import {
  AppShellWireframe,
  ComposerWireframe,
  HomeWireframe,
  PaletteWireframe,
  SurfaceMapContext,
  type SurfaceMapState
} from './wireframes.js';
import { SurfaceCard } from './surface-card.js';
import { SURFACES_BY_ID } from './surfaces.js';

const LAST = SURFACE_GROUPS.length - 1;

describe('panCarets', () => {
  it('disables the caret that has nowhere to go', () => {
    expect(panCarets(0, SURFACE_GROUPS.length)).toEqual({ previous: false, next: true });
    expect(panCarets(LAST, SURFACE_GROUPS.length)).toEqual({ previous: true, next: false });
  });

  it('enables both carets everywhere in between', () => {
    for (let index = 1; index < LAST; index++) {
      expect(panCarets(index, SURFACE_GROUPS.length)).toEqual({ previous: true, next: true });
    }
  });

  it('disables both carets when there is a single slide', () => {
    expect(panCarets(0, 1)).toEqual({ previous: false, next: false });
  });
});

describe('annotationNeighbors', () => {
  const surfaces = SURFACE_GROUPS[0]!.surfaces;

  it('moves through annotations in their authored numeric order', () => {
    expect(annotationNeighbors(surfaces, surfaces[1]!.id)).toEqual({
      previous: surfaces[0],
      next: surfaces[2]
    });
  });

  it('keeps the missing direction disabled at each endpoint', () => {
    expect(annotationNeighbors(surfaces, surfaces[0]!.id)).toEqual({
      previous: null,
      next: surfaces[1]
    });
    expect(annotationNeighbors(surfaces, surfaces.at(-1)!.id)).toEqual({
      previous: surfaces.at(-2),
      next: null
    });
  });
});

describe('spatial scale', () => {
  it('scales together and caps at the legibility ceiling', () => {
    expect(spatialFixtureScale(360, 720)).toBe(0.5);
    expect(spatialFixtureScale(720, 720)).toBe(1);
    expect(spatialFixtureScale(1280, 720)).toBe(MAX_FIXTURE_SCALE);
    expect(spatialFixtureScale(1280, 720, 700, 700)).toBe(1);
    expect(spatialFixtureScale(1280, 720, 350, 700)).toBe(0.5);
    expect(spatialFixtureScale(1280, 720, 7000, 700)).toBe(MAX_FIXTURE_SCALE);
    expect(spatialFixtureScale(360, 720, 7000, 700)).toBe(0.5);
  });

  it('keeps annotation chips legible while the fixture shrinks', () => {
    expect(annotationChipCounterScale(0.5)).toBe(2);
    expect(annotationChipCounterScale(0.8)).toBeCloseTo(1.25, 10);
    for (const scale of [0.5, 0.6, 0.8, 0.95]) {
      expect(scale * annotationChipCounterScale(scale)).toBeCloseTo(1, 10);
    }
    expect(annotationChipCounterScale(1)).toBe(1);
    expect(annotationChipCounterScale(MAX_FIXTURE_SCALE)).toBe(1);
    expect(annotationChipCounterScale(0.2)).toBe(MAX_CHIP_COUNTER_SCALE);
    expect(annotationChipCounterScale(0)).toBe(1);
    expect(annotationChipCounterScale(Number.NaN)).toBe(1);
  });
});

describe('renderSurfaceCopy', () => {
  it('renders backtick spans as code', () => {
    const markup = renderToStaticMarkup(createElement('div', null, renderSurfaceCopy('See `navPanel`.')));
    expect(markup).toContain('<code');
    expect(markup).toContain('navPanel');
  });
});

const mapState = (overrides: Partial<SurfaceMapState> = {}): SurfaceMapState => ({
  activeId: null,
  setActiveId: vi.fn(),
  expandedId: null,
  numberOf: (id) => SURFACE_NUMBERS.get(id) ?? null,
  ...overrides
});

describe('ProductMap chrome', () => {
  it('renders named slide pills and scale-together plus reflow strategies', () => {
    const markup = renderToStaticMarkup(createElement(ProductMap));
    expect(markup).toContain('App shell');
    expect(markup).toContain('Command palette');
    expect(markup).not.toContain('plugin-guide-dots');
    expect(markup.match(/data-guide-responsive-strategy="scale-together"/g)?.length).toBe(6);
    expect(markup).toContain('--guide-chip-scale');
    const platform = renderToStaticMarkup(createElement(ProductMap, { initialSlideId: 'headless' }));
    expect(platform).toContain('data-guide-responsive-strategy="reflow"');
    expect(platform).toContain('Agent capabilities');
    expect(platform).not.toContain('plugin-guide-chip is-static');
  });
});

describe('fixtures', () => {
  it('renders the workspace shell: Workspaces header, project rail, and topbar', () => {
    const markup = renderToStaticMarkup(
      createElement(SurfaceMapContext.Provider, { value: mapState() }, createElement(AppShellWireframe))
    );
    expect(markup).toContain('Workspaces');
    expect(markup).toContain('title="Organize workspaces"');
    expect(markup).toContain('title="Workspace menu"');
    expect(markup).toContain('title="Add project"');
    expect(markup).toContain('plugin-guide-workspace');
    expect(markup).toContain('plugin-guide-ws-topbar');
    expect(markup).toContain('plugin-guide-ws-rail-head');
    expect(markup).toContain('Explorer');
    expect(markup).toContain('Library');
  });

  it('opens the command palette on the palette slide', () => {
    const markup = renderToStaticMarkup(
      createElement(SurfaceMapContext.Provider, { value: mapState() }, createElement(PaletteWireframe))
    );
    expect(markup).toContain('data-guide-state="palette-open"');
    expect(markup).toContain('Run release checklist');
  });

  it('renders home as New Chat compose with aurora and plugin CTAs under the prompt', () => {
    const markup = renderToStaticMarkup(
      createElement(SurfaceMapContext.Provider, { value: mapState() }, createElement(HomeWireframe))
    );
    expect(markup).toContain('aurora-host');
    expect(markup).toContain('aurora-grid');
    expect(markup).toContain('New Chat');
    expect(markup).toContain('Describe the task');
    expect(markup).toContain('plugin-guide-composer-card');
    expect(markup).toContain('Your action');
    expect(markup).toContain('Your section');
    expect(markup).not.toContain('Ask anything');
  });

  it('shows composer chrome: command card, plugin action, and banner', () => {
    const markup = renderToStaticMarkup(
      createElement(
        SurfaceMapContext.Provider,
        { value: mapState({ expandedId: 'composer' }) },
        createElement(ComposerWireframe)
      )
    );
    expect(markup).toContain('data-guide-transient-for="composer"');
    expect(markup).toContain('Your action');
    expect(markup).toContain('Your banner');
    expect(markup).toContain('plugin-guide-composer-card');
    expect(markup).toContain('Claude Code');
    expect(markup).toContain('Full Access');
    expect(markup).not.toContain('Ask anything');
  });
});

describe('SurfaceCard', () => {
  it('is a dialog with always-visible annotation navigation', () => {
    const surface = SURFACES_BY_ID.get('navPanel')!;
    const markup = renderToStaticMarkup(
      createElement(SurfaceCard, {
        surface,
        number: 1,
        onDismiss: () => undefined,
        navigation: { previous: null, next: SURFACES_BY_ID.get('projectTab')!, onOpen: () => undefined }
      })
    );
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('No previous annotation');
    expect(markup).toContain('Next annotation: Project tab');
    expect(markup).toContain('Copy for agent');
    expect(markup).not.toContain('PluginAppSlots.navPanel');
  });
});

describe('platform sections', () => {
  it('lists every headless surface in exactly one section', () => {
    const headless = SURFACE_GROUPS.find((group) => group.id === 'headless')!;
    const sectionIds = headless.sections!.flatMap((section) => section.surfaceIds);
    expect(new Set(sectionIds)).toEqual(new Set(headless.surfaces.map((surface) => surface.id)));
    expect(sectionIds).toHaveLength(headless.surfaces.length);
  });
});
