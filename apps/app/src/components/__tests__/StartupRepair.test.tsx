import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { StartupError, StartupRepair } from '../StartupRepair.js';

describe('StartupRepair', () => {
  it('renders only bounded recovery actions and an accessible status surface', () => {
    const html = renderToStaticMarkup(<StartupRepair />);

    expect(html).toContain('Routing settings need repair');
    expect(html).toContain('Retry migration');
    expect(html).toContain('Open diagnostics');
    expect(html).toContain('Quit');
    expect(html).toContain('How to repair routing settings');
    expect(html).toContain('migration backup and report');
    expect(html).not.toContain('github.com');
    expect(html).not.toContain('git.soma.salesforce.com');
    expect(html).not.toContain('Projects');
    expect(html).not.toContain('Settings');
  });
});

describe('StartupError', () => {
  it('renders bounded recovery actions and announces startup state failures', () => {
    const html = renderToStaticMarkup(<StartupError error="IPC unavailable" onRetry={() => {}} />);

    expect(html).toContain('Command Center could not start');
    expect(html).toContain('role="alert"');
    expect(html).toContain('IPC unavailable');
    expect(html).toContain('Retry');
    expect(html).toContain('Quit');
    expect(html).not.toContain('Projects');
  });
});
