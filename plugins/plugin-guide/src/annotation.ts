import { Fragment, createElement, type ReactNode } from 'react';
import { SURFACE_GROUPS, type PluginSurface } from './surfaces.js';

export const MAX_FIXTURE_SCALE = 1.2;
export const MAX_CHIP_COUNTER_SCALE = 3;
export const CHIP_COUNTER_SCALE_PROPERTY = '--guide-chip-scale';

export const SURFACE_NUMBERS: ReadonlyMap<string, number> = new Map(
  SURFACE_GROUPS.filter((group) => group.id !== 'headless').flatMap((group) =>
    group.surfaces.map((surface, index) => [surface.id, index + 1] as const)
  )
);

export function annotationNeighbors(
  surfaces: readonly PluginSurface[],
  currentId: string
): { previous: PluginSurface | null; next: PluginSurface | null } {
  const currentIndex = surfaces.findIndex((surface) => surface.id === currentId);
  if (currentIndex === -1) {
    return { previous: null, next: null };
  }
  return {
    previous: surfaces[currentIndex - 1] ?? null,
    next: surfaces[currentIndex + 1] ?? null
  };
}

export function panCarets(index: number, slideCount: number): { previous: boolean; next: boolean } {
  return { previous: index > 0, next: index < slideCount - 1 };
}

export function spatialFixtureScale(
  availableWidth: number,
  authoredWidth: number,
  availableHeight?: number,
  authoredHeight?: number
): number {
  if (availableWidth <= 0 || authoredWidth <= 0) return 1;
  const heightScale =
    availableHeight !== undefined &&
    authoredHeight !== undefined &&
    availableHeight > 0 &&
    authoredHeight > 0
      ? availableHeight / authoredHeight
      : Number.POSITIVE_INFINITY;
  return Math.min(MAX_FIXTURE_SCALE, availableWidth / authoredWidth, heightScale);
}

export function annotationChipCounterScale(fixtureScale: number): number {
  if (!Number.isFinite(fixtureScale) || fixtureScale <= 0) return 1;
  return Math.min(MAX_CHIP_COUNTER_SCALE, Math.max(1, 1 / fixtureScale));
}

export type AnnotationChipPlacement = 'corner' | 'corner-inset' | 'side' | 'outside-above';

export const CHIP_PLACEMENT_CLASS: Record<AnnotationChipPlacement, string> = {
  corner: 'plugin-guide-chip-place--corner',
  'corner-inset': 'plugin-guide-chip-place--corner-inset',
  side: 'plugin-guide-chip-place--side',
  'outside-above': 'plugin-guide-chip-place--above'
};

export function annotationChipClass(active: boolean, extra?: string): string {
  return ['plugin-guide-chip', active ? 'is-active' : '', extra ?? ''].filter(Boolean).join(' ');
}

export function ExperimentalBadge(): ReactNode {
  return createElement(
    'span',
    {
      className: 'plugin-guide-experimental',
      title: 'Experimental: the slot may change before it is marked stable.'
    },
    'experimental'
  );
}

export interface SurfaceReference {
  number: number | null;
  otherPage: string | null;
  onOpen: () => void;
}

const COPY_TOKEN = /(`[^`]+`)|(\[[^\]]+\]\([a-z0-9_-]+\))|(\{experimental\})/g;

export function renderSurfaceCopy(
  text: string,
  resolve?: (id: string) => SurfaceReference | null
): ReactNode {
  const parts = text.split(COPY_TOKEN).filter((part) => part !== undefined);
  if (parts.length < 2) {
    return text;
  }
  return parts.map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return createElement('code', { key: index, className: 'plugin-guide-inline-code' }, part.slice(1, -1));
    }
    if (part === '{experimental}') {
      return createElement(Fragment, { key: index }, ' ', createElement(ExperimentalBadge));
    }
    const reference = /^\[([^\]]+)\]\(([a-z0-9_-]+)\)$/.exec(part);
    if (!reference) {
      return createElement(Fragment, { key: index }, part);
    }
    const [, label, id] = reference;
    const target = resolve?.(id) ?? null;
    if (!target) {
      return createElement(Fragment, { key: index }, label);
    }
    return createElement(
      'button',
      {
        key: index,
        type: 'button',
        className: 'plugin-guide-ref',
        onClick: target.onOpen,
        title: target.otherPage ? `On ${target.otherPage}` : undefined,
        'aria-label': target.otherPage ? `Go to ${label} on ${target.otherPage}` : `Go to ${label} on this page`
      },
      label
    );
  });
}
