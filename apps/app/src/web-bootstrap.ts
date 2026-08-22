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
  const contentType = response.headers.get('content-type') ?? '';
  const body = await response.text();
  if (!response.ok) throw new Error(`Local web bootstrap failed (${response.status})`);
  if (!contentType.includes('application/json')) {
    throw new Error('Local web bootstrap is not available on this origin');
  }
  try {
    return JSON.parse(body) as BrowserBootstrap;
  } catch {
    throw new Error('Local web bootstrap returned invalid JSON');
  }
}
