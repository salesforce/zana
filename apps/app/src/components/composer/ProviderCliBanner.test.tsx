/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isBlockingProviderCliStatus,
  ProviderCliBanner,
  providerCliBlockedReason,
  providerCliVersionRequirementCopy
} from './ProviderCliBanner.js';

afterEach(() => {
  cleanup();
});

describe('providerCli helpers', () => {
  it('phrases install vs update blocked reasons', () => {
    expect(providerCliBlockedReason({ displayName: 'Codex', installed: false }))
      .toBe('Install Codex before starting a thread.');
    expect(providerCliBlockedReason({ displayName: 'Codex', installed: true }))
      .toBe('Update Codex before starting a thread.');
  });

  it('formats version requirement copy without repeating null floors', () => {
    expect(providerCliVersionRequirementCopy('0.135.0', '0.136.0'))
      .toBe('Installed 0.135.0; version 0.136.0 or newer is required.');
    expect(providerCliVersionRequirementCopy('0.135.0', null))
      .toBe('Installed 0.135.0; a newer version is required.');
    expect(providerCliVersionRequirementCopy(null, '2.1.0'))
      .toBe('Version 2.1.0 or newer is required.');
  });

  it('blocks send when the CLI is missing or unsupported', () => {
    expect(isBlockingProviderCliStatus({
      displayName: 'Codex',
      executableName: 'codex',
      executablePath: null,
      installed: false,
      installSource: 'unknown',
      currentVersion: null,
      latestVersion: null,
      minimumSupportedVersion: null,
      npmPackageName: null,
      npmGlobalPackageVersion: null,
      installAction: null,
      needsUpdate: false,
      versionUnsupported: false
    })).toBe(true);
    expect(isBlockingProviderCliStatus({
      displayName: 'Codex',
      executableName: 'codex',
      executablePath: '/usr/local/bin/codex',
      installed: true,
      installSource: 'path',
      currentVersion: '0.1.0',
      latestVersion: '0.2.0',
      minimumSupportedVersion: '0.2.0',
      npmPackageName: null,
      npmGlobalPackageVersion: null,
      installAction: null,
      needsUpdate: true,
      versionUnsupported: true
    })).toBe(true);
    expect(isBlockingProviderCliStatus({
      displayName: 'Codex',
      executableName: 'codex',
      executablePath: '/usr/local/bin/codex',
      installed: true,
      installSource: 'path',
      currentVersion: '0.2.0',
      latestVersion: '0.2.0',
      minimumSupportedVersion: '0.2.0',
      npmPackageName: null,
      npmGlobalPackageVersion: null,
      installAction: null,
      needsUpdate: false,
      versionUnsupported: false
    })).toBe(false);
  });
});

describe('ProviderCliBanner', () => {
  it('asks for an install when the CLI is missing', () => {
    const onAction = vi.fn();
    render(
      <ProviderCliBanner
        displayName="Claude Code"
        installed={false}
        currentVersion={null}
        minimumSupportedVersion="2.1.0"
        canRunAction
        actionRunning={false}
        onAction={onAction}
      />
    );

    expect(screen.getByRole('region', { name: 'Claude Code not installed' })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).not.toContain('version');
    fireEvent.click(screen.getByRole('button', { name: 'Install Claude Code' }));
    expect(onAction).toHaveBeenCalledOnce();
  });

  it('shows update progress for an unsupported version', () => {
    render(
      <ProviderCliBanner
        displayName="Codex"
        installed
        currentVersion="0.135.0"
        minimumSupportedVersion={null}
        canRunAction
        actionRunning
        onAction={vi.fn()}
      />
    );

    expect(screen.getByRole('alert').textContent).toContain(
      'Installed 0.135.0; a newer version is required.'
    );
    expect((screen.getByRole('button', { name: 'Updating…' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
