import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CliSkillsMachinePanel } from './CliSkillsSettings.js';

describe('CliSkillsMachinePanel', () => {
  it('renders an empty state without an install control', () => {
    const html = renderToStaticMarkup(
      <CliSkillsMachinePanel machines={[]} busyKey={null} error={null} onInstall={vi.fn()} />
    );
    expect(html).toContain('Pair a machine first');
    expect(html).not.toContain('cli-skills-status');
    expect(html).not.toContain('Install all');
  });

  it('puts the hostname, status, and per-machine action on one row', () => {
    const html = renderToStaticMarkup(
      <CliSkillsMachinePanel
        machines={[
          {
            hostId: 'h1',
            hostName: 'grebmann-ltmmfjc.internal.salesforce.com',
            status: 'outdated'
          }
        ]}
        busyKey={null}
        error={null}
        onInstall={vi.fn()}
      />
    );
    expect(html).toContain('data-testid="cli-skills-status"');
    expect(html).toContain('grebmann-ltmmfjc.internal.salesforce.com');
    expect(html).toContain('Needs update');
    expect(html).toContain('Update');
    expect(html).not.toContain('Install all');
    expect(html).not.toContain('settings-btn primary');
  });

  it('shows a bulk update control only when two or more machines need work', () => {
    const html = renderToStaticMarkup(
      <CliSkillsMachinePanel
        machines={[
          { hostId: 'a', hostName: 'alpha', status: 'missing' },
          { hostId: 'b', hostName: 'beta', status: 'outdated' }
        ]}
        busyKey={null}
        error={null}
        onInstall={vi.fn()}
      />
    );
    expect(html).toContain('Update all (2)');
    expect(html).toContain('settings-btn primary');
  });

  it('surfaces an install error under the list', () => {
    const html = renderToStaticMarkup(
      <CliSkillsMachinePanel
        machines={[{ hostId: 'a', hostName: 'alpha', status: 'missing' }]}
        busyKey={null}
        error="alpha: offline"
        onInstall={vi.fn()}
      />
    );
    expect(html).toContain('alpha: offline');
  });
});
