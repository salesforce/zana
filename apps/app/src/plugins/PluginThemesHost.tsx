import { useEffect, useState } from 'react';
import { apiJson } from '../lib/fetch-with-app-surface.js';

export const PLUGIN_THEME_STORAGE_KEY = 'zcc.plugin.activeTheme';

export interface PluginThemeOption {
  pluginId: string;
  id: string;
  name: string;
  description?: string;
  cssUrl: string;
}

export function themeStorageKey(pluginId: string, id: string): string {
  return `${pluginId}/${id}`;
}

export function readActivePluginTheme(): string | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(PLUGIN_THEME_STORAGE_KEY);
}

export function writeActivePluginTheme(key: string | null): void {
  if (typeof localStorage === 'undefined') return;
  if (!key) localStorage.removeItem(PLUGIN_THEME_STORAGE_KEY);
  else localStorage.setItem(PLUGIN_THEME_STORAGE_KEY, key);
}

export async function loadPluginThemes(): Promise<PluginThemeOption[]> {
  try {
    const body = await apiJson<{ themes?: PluginThemeOption[] }>('/plugins/contributions');
    return Array.isArray(body.themes) ? body.themes : [];
  } catch {
    return [];
  }
}

/** Injects the Settings-pinned plugin CSS theme once at app init (Rule 3). */
export function PluginThemesHost() {
  const [href, setHref] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadPluginThemes().then((themes) => {
      if (cancelled) return;
      const pin = readActivePluginTheme();
      const match = pin
        ? themes.find((theme) => themeStorageKey(theme.pluginId, theme.id) === pin)
        : null;
      setHref(match?.cssUrl ?? null);
    });
    const onStorage = (event: StorageEvent) => {
      if (event.key !== PLUGIN_THEME_STORAGE_KEY) return;
      void loadPluginThemes().then((themes) => {
        if (cancelled) return;
        const pin = readActivePluginTheme();
        const match = pin
          ? themes.find((theme) => themeStorageKey(theme.pluginId, theme.id) === pin)
          : null;
        setHref(match?.cssUrl ?? null);
      });
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener('zcc:plugin-theme-changed', onStorage as EventListener);
    return () => {
      cancelled = true;
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('zcc:plugin-theme-changed', onStorage as EventListener);
    };
  }, []);

  if (!href) return null;
  return <link rel="stylesheet" href={href} data-testid="plugin-theme-stylesheet" />;
}
