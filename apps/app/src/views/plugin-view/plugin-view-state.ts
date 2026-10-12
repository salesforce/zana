import type { PluginProjectTabRegistration } from '@zana-ai/zcc-plugin-sdk/app';
import type { PluginViewSurfaceTarget } from '../../lib/pluginViewSurface.js';
import type { PluginViewTitle } from '../../plugins/plugin-view-title.js';
import type { ShellPlatform } from '../../lib/shellChrome.js';

export type PluginViewState =
  | { kind: 'loading' }
  | { kind: 'missing-project' }
  | { kind: 'missing-tab' }
  | { kind: 'not-detachable'; tab: PluginProjectTabRegistration }
  | { kind: 'ready'; tab: PluginProjectTabRegistration };

/**
 * What a plugin view window shows. Main has already checked the project and
 * plugin; the slot registry lives only in the renderer, so the tab itself (and
 * whether it opted in with `detachable`) is checked here.
 */
export function resolvePluginViewState(input: {
  target: PluginViewSurfaceTarget;
  tabs: readonly PluginProjectTabRegistration[];
  appsReady: boolean;
  projectsLoaded: boolean;
  hasProject: boolean;
}): PluginViewState {
  if (input.projectsLoaded && !input.hasProject) return { kind: 'missing-project' };
  const tab = input.tabs.find(
    (row) => row.pluginId === input.target.pluginId && row.id === input.target.tabId
  );
  if (!tab) return input.appsReady && input.projectsLoaded ? { kind: 'missing-tab' } : { kind: 'loading' };
  if (!input.projectsLoaded) return { kind: 'loading' };
  if (tab.detachable !== true) return { kind: 'not-detachable', tab };
  return { kind: 'ready', tab };
}

function present(parts: Array<string | undefined>): string[] {
  return parts.filter((part): part is string => !!part && part.trim().length > 0);
}

/**
 * OS window title, led by the project like a per-project window (see App.tsx).
 * A plugin's own title leads instead, after its badge, so a risky window reads as one in the
 * OS window list too: "Production · Agentforce · Help — Acme · prod — Zana".
 */
export function pluginViewDocumentTitle(
  label: string | undefined,
  projectName: string | undefined,
  base: string,
  custom?: PluginViewTitle | null
): string {
  if (custom) {
    const tail = present([projectName, custom.detail]);
    return `${present([custom.badge, custom.title]).join(' · ')}${tail.length ? ` — ${tail.join(' · ')}` : ''} — ${base}`;
  }
  const lead = present([projectName, label]);
  return lead.length ? `${lead.join(' · ')} — ${base}` : base;
}

/** The title strip's trailing part: the project, then the plugin's detail. */
export function pluginViewTitleContext(projectName: string | undefined, custom?: PluginViewTitle | null): string {
  return present([projectName, custom?.detail]).join(' · ');
}

/** ⌘W (Ctrl+W elsewhere) closes a plugin view window, as it closes a tab in the main window. */
export function isCloseWindowShortcut(
  event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>,
  platform: ShellPlatform
): boolean {
  const mod = platform === 'macos' ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  return mod && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'w';
}
