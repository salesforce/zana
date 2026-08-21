export interface BrowserProjectSummary {
  id: string;
  name: string;
  color?: string;
  tag?: string;
  category?: string;
}

export interface BrowserBootstrap {
  appVersion: string;
  projects: BrowserProjectSummary[];
}

/**
 * The browser can read only the static host's same-origin bootstrap projection.
 * It deliberately does not emulate `window.cc` or provide an escape hatch into
 * Electron IPC, host-daemon credentials, or terminal control.
 */
export async function loadBrowserBootstrap(): Promise<BrowserBootstrap> {
  const response = await fetch('/_zcc/bootstrap', { credentials: 'same-origin' });
  if (!response.ok) throw new Error(`Local web bootstrap failed (${response.status})`);
  return response.json() as Promise<BrowserBootstrap>;
}
