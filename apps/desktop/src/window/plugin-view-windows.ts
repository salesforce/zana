import type { AppConfig } from '@zana-ai/zcc-domain/product';
import type { PluginViewTarget } from '@zana-ai/zcc-desktop-contract';
import { restoreWindowState, type DisplayWorkArea, type WindowBounds as FullBounds } from './bounds-state.js';

/**
 * A plugin view window shows one plugin project tab on its own, outside the
 * main shell. Main cannot see renderer slot registrations, so it checks what it
 * can know (a registered project and an enabled plugin with an app bundle) and
 * the window's renderer reports a tab that is missing or not detachable.
 */
export const PLUGIN_VIEW_SURFACE = 'plugin-view';
/** Saved geometry is kept for this many views, newest first. */
export const PLUGIN_VIEW_BOUNDS_CAP = 24;
export const PLUGIN_VIEW_DEFAULT_SIZE = { width: 1280, height: 820 } as const;
export const PLUGIN_VIEW_MIN_SIZE = { width: 720, height: 480 } as const;

const PLUGIN_ID = /^[a-z0-9][a-z0-9-]{0,127}$/;
const TAB_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_PROJECT_ID = 256;
const MAX_MAIN_PATH = 32768;
const MAX_RESOURCE_ID = 2048;

export type PluginViewBoundsRecord = NonNullable<AppConfig['pluginViewWindowBounds']>;
type WindowBounds = NonNullable<AppConfig['windowBounds']>;

export type PluginViewDenial = 'invalid' | 'unknown-project' | 'unknown-plugin' | 'plugin-disabled' | 'no-app';

export type PluginViewApp = {
  id: string;
  enabled: boolean;
  status: string;
  appUrl: string | null;
};

function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/** Validate a renderer-supplied view target. Anything malformed is `null`. */
export function parsePluginViewTarget(input: unknown): PluginViewTarget | null {
  if (!input || typeof input !== 'object') return null;
  const { pluginId, tabId, projectId, resourceId } = input as Record<string, unknown>;
  if (typeof pluginId !== 'string' || !PLUGIN_ID.test(pluginId)) return null;
  if (typeof tabId !== 'string' || !TAB_ID.test(tabId)) return null;
  if (typeof projectId !== 'string' || !projectId.trim() || projectId.length > MAX_PROJECT_ID) return null;
  if (hasControlCharacter(projectId)) return null;
  if (resourceId !== undefined && (typeof resourceId !== 'string' || !resourceId.trim() || resourceId.length > MAX_RESOURCE_ID || hasControlCharacter(resourceId))) return null;
  return { pluginId, tabId, projectId, ...(resourceId === undefined ? {} : { resourceId }) };
}

export function pluginViewKey(target: PluginViewTarget): string {
  // Preserve legacy geometry keys; resource windows use an unambiguous tuple.
  return target.resourceId === undefined
    ? `${target.pluginId}/${target.tabId}@${target.projectId}`
    : JSON.stringify([target.pluginId, target.tabId, target.projectId, target.resourceId]);
}

export function samePluginView(a: PluginViewTarget | undefined, b: PluginViewTarget): boolean {
  return !!a && a.pluginId === b.pluginId && a.tabId === b.tabId && a.projectId === b.projectId && a.resourceId === b.resourceId;
}

/** Main's checks before it opens a view window (Rule 1: the renderer is untrusted). */
export function authorizePluginView(
  input: unknown,
  known: { projectIds: Iterable<string>; apps: readonly PluginViewApp[] }
): { ok: true; target: PluginViewTarget } | { ok: false; reason: PluginViewDenial } {
  const target = parsePluginViewTarget(input);
  if (!target) return { ok: false, reason: 'invalid' };
  if (![...known.projectIds].includes(target.projectId)) return { ok: false, reason: 'unknown-project' };
  const app = known.apps.find((row) => row.id === target.pluginId);
  if (!app) return { ok: false, reason: 'unknown-plugin' };
  if (!app.enabled || app.status === 'disabled') return { ok: false, reason: 'plugin-disabled' };
  if (!app.appUrl) return { ok: false, reason: 'no-app' };
  return { ok: true, target };
}

/** Search params for the view window's renderer. `projectId` keeps it a scoped, non-owning window. */
export function pluginViewRendererParams(target: PluginViewTarget): Record<string, string> {
  return {
    projectId: target.projectId,
    surface: PLUGIN_VIEW_SURFACE,
    pluginId: target.pluginId,
    tabId: target.tabId,
    ...(target.resourceId === undefined ? {} : { resourceId: target.resourceId })
  };
}

/**
 * Where a menu command goes when a plugin view window has focus. It has no tabs,
 * palette or settings of its own: Close Tab closes it, the rest go to the main window.
 */
export function pluginViewMenuRoute(channel: string): 'close' | 'main' {
  return channel === 'app:closeTab' ? 'close' : 'main';
}

/** The open view windows, in registry order, for `windows:listPluginViews`. */
export function listPluginViews(
  entries: Iterable<{ view?: PluginViewTarget; live: boolean }>
): PluginViewTarget[] {
  const views: PluginViewTarget[] = [];
  for (const entry of entries) {
    if (entry.view && entry.live) views.push({ ...entry.view });
  }
  return views;
}

/** A relative in-app path the main window may navigate to. */
export function parseMainWindowPath(input: unknown): string | null {
  if (typeof input !== 'string' || input.length === 0 || input.length > MAX_MAIN_PATH) return null;
  if (!input.startsWith('/') || input.startsWith('//') || input.includes('\\')) return null;
  if (hasControlCharacter(input)) return null;
  return input;
}

export function readPluginViewBounds(
  record: AppConfig['pluginViewWindowBounds'] | undefined,
  key: string
): { bounds?: WindowBounds; maximized: boolean } {
  const saved = record?.[key];
  return { bounds: saved?.bounds, maximized: saved?.maximized === true };
}

/** Store one view's geometry and keep only the newest {@link PLUGIN_VIEW_BOUNDS_CAP} entries (Rule 5). */
export function writePluginViewBounds(
  record: AppConfig['pluginViewWindowBounds'] | undefined,
  key: string,
  state: Pick<AppConfig, 'windowBounds' | 'windowMaximized'>,
  now: number,
  cap = PLUGIN_VIEW_BOUNDS_CAP
): PluginViewBoundsRecord {
  const previous = record?.[key];
  const bounds = state.windowBounds ?? previous?.bounds;
  const next: PluginViewBoundsRecord = { ...(record ?? {}) };
  next[key] = {
    ...(bounds ? { bounds: { ...bounds } } : {}),
    ...(state.windowMaximized === true ? { maximized: true } : {}),
    at: now
  };
  const newest = Object.entries(next)
    .sort(([, a], [, b]) => b.at - a.at)
    .slice(0, Math.max(1, cap));
  return Object.fromEntries(newest);
}

export type PluginViewGeometry = {
  /** BrowserWindow size and position options. No `x`/`y` lets Electron center a new window. */
  options: { width: number; height: number; x?: number; y?: number; minWidth: number; minHeight: number };
  /** Saved bounds fitted to a visible display, when this view had any. */
  bounds?: FullBounds;
  maximized: boolean;
};

/** Size a view window: its saved geometry on a visible display, else the default size. */
export function pluginViewWindowGeometry(
  saved: ReturnType<typeof readPluginViewBounds>,
  displays: DisplayWorkArea[],
  primary: DisplayWorkArea
): PluginViewGeometry {
  if (!saved.bounds || saved.bounds.x === undefined || saved.bounds.y === undefined) {
    const area = primary.workArea;
    return {
      options: {
        width: Math.min(saved.bounds?.width ?? PLUGIN_VIEW_DEFAULT_SIZE.width, area.width),
        height: Math.min(saved.bounds?.height ?? PLUGIN_VIEW_DEFAULT_SIZE.height, area.height),
        minWidth: Math.min(PLUGIN_VIEW_MIN_SIZE.width, area.width),
        minHeight: Math.min(PLUGIN_VIEW_MIN_SIZE.height, area.height)
      },
      maximized: saved.maximized
    };
  }
  const restored = restoreWindowState(saved.bounds, saved.maximized, displays, primary);
  return {
    options: {
      ...restored.bounds,
      // restoreWindowState caps its minimum at the work area; the view minimum is smaller still.
      minWidth: Math.min(PLUGIN_VIEW_MIN_SIZE.width, restored.minWidth),
      minHeight: Math.min(PLUGIN_VIEW_MIN_SIZE.height, restored.minHeight)
    },
    bounds: restored.bounds,
    maximized: restored.maximized
  };
}
