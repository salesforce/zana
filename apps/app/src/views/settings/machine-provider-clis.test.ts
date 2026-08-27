import { describe, expect, it } from 'vitest';
import type { ProviderCliStatus, ProviderCliStatusResponse } from '@zana-ai/zcc-contracts/host-rpc';
import {
  actionableProviderCliRows,
  machineCliInventorySummary,
  orderedProviderCliRows,
  providerCliBadge,
  providerCliPresentation
} from './machine-provider-clis.js';

function status(overrides: Partial<ProviderCliStatus>): ProviderCliStatus {
  return {
    displayName: 'Codex',
    executableName: 'codex',
    executablePath: '/usr/local/bin/codex',
    installed: true,
    installSource: 'npmGlobal',
    currentVersion: '0.145.0',
    latestVersion: '0.149.1',
    minimumSupportedVersion: '0.136.0',
    npmPackageName: '@openai/codex',
    npmGlobalPackageVersion: '0.145.0',
    installAction: {
      kind: 'update',
      label: 'Update',
      commandKind: 'exec',
      command: 'codex update'
    },
    needsUpdate: true,
    versionUnsupported: false,
    ...overrides
  };
}

describe('machine provider CLI rows', () => {
  it('orders known families and counts update-all actions', () => {
    const inventory: ProviderCliStatusResponse = {
      claudeCode: status({
        displayName: 'Claude Code',
        executableName: 'claude',
        installAction: null,
        needsUpdate: false,
        latestVersion: '2.1.246',
        currentVersion: '2.1.246'
      }),
      codex: status({}),
      pi: status({
        displayName: 'PI',
        executableName: 'pi',
        installed: false,
        installSource: 'notInstalled',
        currentVersion: null,
        installAction: {
          kind: 'install',
          label: 'Install',
          commandKind: 'exec',
          command: 'npm install -g @earendil-works/pi-coding-agent@latest'
        },
        needsUpdate: false
      })
    };
    expect(orderedProviderCliRows(inventory).map((row) => row.provider)).toEqual([
      'codex',
      'claudeCode',
      'pi'
    ]);
    expect(providerCliBadge(inventory.codex!)).toBe('Update');
    expect(providerCliBadge(inventory.claudeCode!)).toBeNull();
    expect(providerCliBadge(inventory.pi!)).toBe('Not installed');
    expect(actionableProviderCliRows({ 'host-1': inventory })).toHaveLength(2);
  });

  it('presents current, update, unsupported, and missing CLIs', () => {
    expect(providerCliPresentation(status({
      installAction: null,
      needsUpdate: false,
      latestVersion: '0.145.0'
    }))).toEqual({
      tone: 'ok',
      badge: 'Current',
      currentLabel: '0.145.0',
      latestLabel: null
    });
    expect(providerCliPresentation(status({}))).toEqual({
      tone: 'warn',
      badge: 'Update',
      currentLabel: '0.145.0',
      latestLabel: '0.149.1'
    });
    expect(providerCliPresentation(status({
      versionUnsupported: true,
      latestVersion: '0.150.0'
    }))).toEqual({
      tone: 'warn',
      badge: 'Unsupported',
      currentLabel: '0.145.0',
      latestLabel: '0.150.0'
    });
    expect(providerCliPresentation(status({
      installed: false,
      currentVersion: null,
      installAction: null
    }))).toEqual({
      tone: 'warn',
      badge: 'Not installed',
      currentLabel: 'Not installed',
      latestLabel: null
    });
  });

  it('summarizes inventory updates', () => {
    expect(machineCliInventorySummary([])).toBeNull();
    expect(machineCliInventorySummary([
      { provider: 'claudeCode', status: status({ installAction: null, needsUpdate: false }) }
    ])).toBe('Up to date');
    expect(machineCliInventorySummary([
      { provider: 'codex', status: status({}) }
    ])).toBe('1 update');
    expect(machineCliInventorySummary([
      { provider: 'codex', status: status({}) },
      { provider: 'pi', status: status({ displayName: 'PI' }) }
    ])).toBe('2 updates');
    expect(orderedProviderCliRows(undefined)).toEqual([]);
    expect(providerCliPresentation(status({
      currentVersion: null,
      installAction: null,
      needsUpdate: false
    })).currentLabel).toBe('Installed');
  });
});
