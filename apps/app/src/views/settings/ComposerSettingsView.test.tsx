// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { COMPOSER_LAUNCH_SURFACES_REV, type AppConfig } from '@zana-ai/zcc-domain/product';
import { ComposerSettingsView } from './ComposerSettingsView.js';
import { FULL_ACCESS_BY_DEFAULT_KEY } from '../../lib/composer-permission-preference.js';

beforeEach(() => localStorage.clear());
afterEach(cleanup);

const config: AppConfig = {
  version: 1,
  theme: 'system',
  shell: '/bin/zsh',
  claudeBinary: 'claude',
  fontSize: 13,
  lastProjectId: null
};

function switchButton(html: string, label: string): string {
  const start = html.lastIndexOf('<button', html.indexOf(`aria-label="${label}"`));
  return html.slice(start, html.indexOf('</button>', start));
}

describe('ComposerSettingsView', () => {
  it('preserves upgrade behavior without importing local Full globally', () => {
    localStorage.setItem(FULL_ACCESS_BY_DEFAULT_KEY, '1');
    const onUpdate = vi.fn();
    render(<ComposerSettingsView config={config} onUpdate={onUpdate} />);
    expect(screen.getByRole('button', { name: 'Default permissions' }).textContent).toContain('Keep existing defaults');
    expect(onUpdate).not.toHaveBeenCalled();
    expect(localStorage.getItem(FULL_ACCESS_BY_DEFAULT_KEY)).toBe('1');
  });

  it.each([
    ['Accept Edits', 'accept-edits'], ['Approve for me', 'auto'], ['Full Access', 'full'], ['Keep existing defaults', null]
  ] as const)('saves %s to shared configuration', async (label, value) => {
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    render(<ComposerSettingsView config={{ ...config, defaultThreadPermissionMode: 'auto' }} onUpdate={onUpdate} />);
    fireEvent.click(screen.getByRole('button', { name: 'Default permissions' }));
    fireEvent.click(screen.getByRole('option', { name: new RegExp(label) }));
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith({ defaultThreadPermissionMode: value }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Default permissions' }).hasAttribute('disabled')).toBe(false));
  });

  it('disables duplicate saves and reports failure while keeping the persisted choice', async () => {
    const pending = Promise.withResolvers<void>();
    const onUpdate = vi.fn(() => pending.promise);
    render(<ComposerSettingsView config={{ ...config, defaultThreadPermissionMode: 'accept-edits' }} onUpdate={onUpdate} />);
    fireEvent.click(screen.getByRole('button', { name: 'Default permissions' }));
    fireEvent.click(screen.getByRole('option', { name: /Full Access/ }));
    expect(screen.getByRole('button', { name: 'Default permissions' }).hasAttribute('disabled')).toBe(true);
    await act(async () => pending.reject(new Error('offline')));
    expect(screen.getByRole('alert').textContent).toContain('Could not save');
    expect(screen.getByRole('button', { name: 'Default permissions' }).textContent).toContain('Accept Edits');
    expect(onUpdate).toHaveBeenCalledOnce();
  });

  it('lists launch surfaces with CLI Agent first and one Team toggle', () => {
    const html = renderToStaticMarkup(
      <ComposerSettingsView config={config} onUpdate={vi.fn().mockResolvedValue(undefined)} />
    );
    expect(html).toContain('settings-anchor-launch-surfaces');
    expect(html).toContain('Launch surfaces');
    expect(html).toContain('At least Modern or CLI Agent must stay on.');
    expect(html).toContain('aria-label="CLI Agent"');
    expect(html).toContain('aria-label="Modern"');
    expect(html).toContain('aria-label="Squad"');
    expect(html).toContain('Show durable Squad mode.');
    expect(html).not.toContain('when at least one team exists');
    expect(html).not.toContain('aria-label="Autonomous Team"');
    expect(html).not.toContain('aria-label="Job Team"');
    expect(html.indexOf('aria-label="CLI Agent"')).toBeLessThan(html.indexOf('aria-label="Modern"'));
    expect(switchButton(html, 'CLI Agent')).toContain('aria-checked="true"');
    expect(switchButton(html, 'Modern')).toContain('aria-checked="true"');
    expect(switchButton(html, 'Squad')).toContain('aria-checked="true"');
    expect(html).toContain('Default launch mode');
    expect(html).toContain('Reload slash commands');
    expect(html).not.toContain('Discover additional native agents');
    expect(html).toContain('settings-anchor-composer');
  });

  it('repairs a both-off pair so all three launch surfaces stay on', () => {
    const html = renderToStaticMarkup(
      <ComposerSettingsView
        config={{ ...config, composerShowCliAgent: false, composerShowModern: false }}
        onUpdate={vi.fn().mockResolvedValue(undefined)}
      />
    );
    expect(switchButton(html, 'CLI Agent')).toContain('aria-checked="true"');
    expect(switchButton(html, 'Modern')).toContain('aria-checked="true"');
    expect(switchButton(html, 'Squad')).toContain('aria-checked="true"');
    expect(switchButton(html, 'CLI Agent')).not.toContain('disabled=""');
    expect(switchButton(html, 'Modern')).not.toContain('disabled=""');
  });

  it('disables the last remaining of Modern or CLI Agent', () => {
    const html = renderToStaticMarkup(
      <ComposerSettingsView
        config={{ ...config, composerShowModern: false }}
        onUpdate={vi.fn().mockResolvedValue(undefined)}
      />
    );
    const cliStart = html.lastIndexOf('<button', html.indexOf('aria-label="CLI Agent"'));
    const cliBtn = html.slice(cliStart, html.indexOf('</button>', cliStart));
    expect(cliBtn).toContain('aria-label="CLI Agent"');
    expect(cliBtn).toContain('disabled=""');
    const modernStart = html.lastIndexOf('<button', html.indexOf('aria-label="Modern"'));
    const modernBtn = html.slice(modernStart, html.indexOf('</button>', modernStart));
    expect(modernBtn).toContain('aria-label="Modern"');
    expect(modernBtn).not.toContain('disabled=""');
  });

  it('resets leftover CLI-only until the launch-surface rev is persisted', () => {
    const leftover = renderToStaticMarkup(
      <ComposerSettingsView
        config={{
          ...config,
          composerShowCliAgent: true,
          composerShowModern: false,
          composerShowAutonomousTeam: false,
          teamJobLaunchEnabled: false
        }}
        onUpdate={vi.fn().mockResolvedValue(undefined)}
      />
    );
    expect(switchButton(leftover, 'CLI Agent')).toContain('aria-checked="true"');
    expect(switchButton(leftover, 'Modern')).toContain('aria-checked="true"');
    expect(switchButton(leftover, 'Squad')).toContain('aria-checked="true"');

    const optedOut = renderToStaticMarkup(
      <ComposerSettingsView
        config={{
          ...config,
          composerShowCliAgent: true,
          composerShowModern: false,
          composerShowAutonomousTeam: false,
          teamJobLaunchEnabled: false,
          composerLaunchSurfacesRev: COMPOSER_LAUNCH_SURFACES_REV
        }}
        onUpdate={vi.fn().mockResolvedValue(undefined)}
      />
    );
    expect(switchButton(optedOut, 'CLI Agent')).toContain('aria-checked="true"');
    expect(switchButton(optedOut, 'Modern')).toContain('aria-checked="false"');
    expect(switchButton(optedOut, 'Squad')).toContain('aria-checked="false"');
  });
});
