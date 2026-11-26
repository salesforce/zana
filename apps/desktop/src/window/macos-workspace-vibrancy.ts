import type { BrowserWindow } from 'electron';

export function supportsMacosWorkspaceVibrancy(platform: NodeJS.Platform, detached: boolean): boolean {
  return platform === 'darwin' && !detached;
}

interface WorkspaceWindow {
  isDestroyed: BrowserWindow['isDestroyed'];
  setBackgroundColor: BrowserWindow['setBackgroundColor'];
  setVibrancy: BrowserWindow['setVibrancy'];
  webContents: {
    on(event: 'did-finish-load', listener: () => void): void;
    off(event: 'did-finish-load', listener: () => void): void;
  };
}

/**
 * Keep the theme-colored native backing through startup and any repair page.
 * The workspace CSS can expose the NSVisualEffectView after loading the shell.
 * A repair window reuses the same WebContents when retry succeeds.
 */
export function bindWorkspaceVibrancy(win: WorkspaceWindow, config: {
  repairing: () => boolean;
  enabled: () => boolean;
  opaqueBackground: () => string;
}): () => void {
  let loaded = false;
  let applied = false;
  function refresh(): void {
    if (!loaded || win.isDestroyed()) return;
    const enabled = config.enabled();
    if (enabled === applied) return;
    if (enabled) {
      win.setVibrancy('sidebar');
      win.setBackgroundColor('#00000000');
    } else {
      win.setBackgroundColor(config.opaqueBackground());
      win.setVibrancy(null);
    }
    applied = enabled;
  }

  function loadedWorkspace(): void {
    if (win.isDestroyed() || config.repairing()) return;
    win.webContents.off('did-finish-load', loadedWorkspace);
    loaded = true;
    refresh();
  }

  win.webContents.on('did-finish-load', loadedWorkspace);
  return refresh;
}
