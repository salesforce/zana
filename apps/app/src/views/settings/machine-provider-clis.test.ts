import { describe, expect, it } from 'vitest';
import type {
  ProviderCliInstallEvent,
  ProviderCliStatus,
  ProviderCliStatusResponse
} from '@zana-ai/zcc-contracts/host-rpc';
import {
  actionableProviderCliRows,
  installProviderCliOnMachine,
  machineCliInventorySummary,
  orderedProviderCliRows,
  parseProviderCliUpdateHint,
  providerCliBadge,
  providerCliBusyLabel,
  dismissInstallLogOnSuccess,
  providerCliInstallLogLines,
  providerCliInstallOutcome,
  providerCliInstallOutputSnippet,
  providerCliKeyForFamily,
  providerCliPresentation,
  providerCliStartLog
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
      latestLabel: null,
      hint: null
    });
    expect(providerCliPresentation(status({}))).toEqual({
      tone: 'warn',
      badge: 'Update',
      currentLabel: '0.145.0',
      latestLabel: '0.149.1',
      hint: null
    });
    expect(providerCliPresentation(status({
      versionUnsupported: true,
      latestVersion: '0.150.0'
    }))).toEqual({
      tone: 'warn',
      badge: 'Unsupported',
      currentLabel: '0.145.0',
      latestLabel: '0.150.0',
      hint: null
    });
    expect(providerCliPresentation(status({
      installed: false,
      currentVersion: null,
      installAction: null
    }))).toEqual({
      tone: 'warn',
      badge: 'Not installed',
      currentLabel: 'Not installed',
      latestLabel: null,
      hint: null
    });
    expect(providerCliPresentation(status({
      installAction: null,
      updateUnavailableReason: 'Managed by Homebrew. Update with `brew upgrade codex`.'
    }))).toEqual({
      tone: 'warn',
      badge: 'Homebrew',
      currentLabel: '0.145.0',
      latestLabel: '0.149.1',
      hint: 'Managed by Homebrew. Update with `brew upgrade codex`.'
    });
    expect(providerCliPresentation(status({
      installAction: null,
      updateUnavailableReason: 'ZCC cannot update this CLI. PATH is /Users/me/.local/bin/opencode.'
    }))).toEqual({
      tone: 'warn',
      badge: 'External',
      currentLabel: '0.145.0',
      latestLabel: '0.149.1',
      hint: 'ZCC cannot update this CLI. PATH is /Users/me/.local/bin/opencode.'
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
    expect(machineCliInventorySummary([
      {
        provider: 'codex',
        status: status({
          installAction: null,
          updateUnavailableReason: 'Managed by Homebrew. Update with `brew upgrade codex`.'
        })
      }
    ])).toBeNull();
    expect(orderedProviderCliRows(undefined)).toEqual([]);
    expect(providerCliPresentation(status({
      currentVersion: null,
      installAction: null,
      needsUpdate: false
    })).currentLabel).toBe('Installed');
  });

  it('splits Homebrew and PATH hints for the settings note', () => {
    expect(parseProviderCliUpdateHint(
      'Managed by Homebrew. Update with `brew upgrade codex`.'
    )).toEqual({ kind: 'homebrew', formula: 'codex' });
    expect(parseProviderCliUpdateHint(
      'ZCC cannot update this CLI. PATH is /Users/me/.local/bin/opencode (resolves to /opt/vendor/pkgs/opencode/1.18.4/opencode).'
    )).toEqual({
      kind: 'external',
      path: '/Users/me/.local/bin/opencode',
      resolvedPath: '/opt/vendor/pkgs/opencode/1.18.4/opencode'
    });
    expect(parseProviderCliUpdateHint(
      'ZCC cannot update this CLI. PATH is /usr/local/bin/opencode.'
    )).toEqual({
      kind: 'external',
      path: '/usr/local/bin/opencode',
      resolvedPath: null
    });
    expect(parseProviderCliUpdateHint('Use the vendor installer.')).toEqual({
      kind: 'plain',
      text: 'Use the vendor installer.'
    });
  });

  it('maps harness families onto provider CLI keys and labels busy work', () => {
    expect(providerCliKeyForFamily('claude')).toBe('claudeCode');
    expect(providerCliKeyForFamily('codex')).toBe('codex');
    expect(providerCliKeyForFamily('grok')).toBeNull();
    expect(providerCliBusyLabel('update')).toBe('Updating…');
    expect(providerCliBusyLabel('install')).toBe('Installing…');
    expect(providerCliStartLog('codex update')).toBe(
      'Running `codex update`. This can take a few minutes.'
    );
    expect(providerCliInstallLogLines([
      { type: 'started', provider: 'codex', command: 'codex update' },
      { type: 'output', provider: 'codex', stream: 'stdout', text: 'Updating Codex via npm\n' },
      { type: 'completed', provider: 'codex', exitCode: 0, signal: null, success: true }
    ])).toEqual([
      'Running `codex update`. This can take a few minutes.',
      'Updating Codex via npm',
      'Finished.'
    ]);
  });

  it('dismisses only the successful row log', () => {
    const logs = {
      'h1:codex': 'Finished.',
      'h1:opencode': 'Running `npm install -g opencode-ai@latest`. This can take a few minutes.'
    };
    expect(dismissInstallLogOnSuccess(logs, 'h1:codex', true)).toEqual({
      'h1:opencode': logs['h1:opencode']
    });
    expect(dismissInstallLogOnSuccess(logs, 'h1:codex', false)).toBe(logs);
    expect(dismissInstallLogOnSuccess(logs, 'h1:missing', true)).toBe(logs);
  });
});

function events(...rows: ProviderCliInstallEvent[]): ProviderCliInstallEvent[] {
  return rows;
}

describe('providerCliInstallOutcome', () => {
  it('treats a successful completed event as ok', () => {
    expect(providerCliInstallOutcome(events(
      { type: 'started', provider: 'codex', command: 'codex update' },
      { type: 'completed', provider: 'codex', exitCode: 0, signal: null, success: true }
    ))).toEqual({ ok: true });
  });

  it('prefers an error event over a later unsuccessful close', () => {
    expect(providerCliInstallOutcome(events(
      { type: 'error', provider: 'codex', message: 'Provider CLI install timed out after 600000ms' },
      { type: 'completed', provider: 'codex', exitCode: 1, signal: null, success: false }
    ))).toEqual({
      ok: false,
      message: 'Provider CLI install timed out after 600000ms'
    });
  });

  it('shows the last stderr lines when the command exits non-zero', () => {
    expect(providerCliInstallOutcome(events(
      { type: 'output', provider: 'pi', stream: 'stdout', text: 'downloading\n' },
      { type: 'output', provider: 'pi', stream: 'stderr', text: 'npm ERR! code EACCES\nnpm ERR! permission denied\n' },
      { type: 'completed', provider: 'pi', exitCode: 1, signal: null, success: false }
    ))).toEqual({
      ok: false,
      message: 'npm ERR! code EACCES\nnpm ERR! permission denied'
    });
  });

  it('falls back to stdout, then exit code, then signal', () => {
    expect(providerCliInstallOutcome(events(
      { type: 'output', provider: 'cursor', stream: 'stdout', text: 'agent not found\n' },
      { type: 'completed', provider: 'cursor', exitCode: 127, signal: null, success: false }
    ))).toEqual({ ok: false, message: 'agent not found' });
    expect(providerCliInstallOutcome(events(
      { type: 'completed', provider: 'cursor', exitCode: 2, signal: null, success: false }
    ))).toEqual({ ok: false, message: 'Install failed (exit 2)' });
    expect(providerCliInstallOutcome(events(
      { type: 'completed', provider: 'cursor', exitCode: null, signal: 'SIGTERM', success: false }
    ))).toEqual({ ok: false, message: 'Install failed (SIGTERM)' });
    expect(providerCliInstallOutcome(events(
      { type: 'completed', provider: 'cursor', exitCode: null, signal: null, success: false }
    ))).toEqual({ ok: false, message: 'Install failed' });
  });

  it('fails when the stream never finishes', () => {
    expect(providerCliInstallOutcome([])).toEqual({
      ok: false,
      message: 'Install did not complete'
    });
    expect(providerCliInstallOutcome(events(
      { type: 'started', provider: 'opencode', command: 'npm install -g opencode-ai' }
    ))).toEqual({ ok: false, message: 'Install did not complete' });
  });
});

describe('providerCliInstallOutputSnippet', () => {
  it('keeps the last stderr lines and ignores blank ones', () => {
    const lines = Array.from({ length: 12 }, (_, i) => `line ${i + 1}`);
    expect(providerCliInstallOutputSnippet(events(
      { type: 'output', provider: 'codex', stream: 'stderr', text: `${lines.join('\n')}\n\n` }
    ))).toBe(lines.slice(-8).join('\n'));
  });

  it('caps an oversized dump so the row stays readable', () => {
    const dump = 'x'.repeat(800);
    const snippet = providerCliInstallOutputSnippet(events(
      { type: 'output', provider: 'codex', stream: 'stderr', text: dump }
    ));
    expect(snippet).toHaveLength(600);
    expect(snippet).toBe(dump.slice(-600));
  });
});

describe('installProviderCliOnMachine', () => {
  it('returns the parsed stream outcome', async () => {
    const seen: string[] = [];
    await expect(installProviderCliOnMachine({
      hostId: 'h1',
      provider: 'codex',
      actionKind: 'update',
      onEvent: (event) => {
        if (event.type === 'started') seen.push(event.command);
      },
      install: async (_hostId, _request, onEvent) => {
        const events = [
          { type: 'started' as const, provider: 'codex' as const, command: 'codex update' },
          { type: 'completed' as const, provider: 'codex' as const, exitCode: 0, signal: null, success: true }
        ];
        for (const event of events) onEvent?.(event);
        return events;
      }
    })).resolves.toEqual({ ok: true });
    expect(seen).toEqual(['codex update']);
  });

  it('turns thrown failures into a visible message', async () => {
    await expect(installProviderCliOnMachine({
      hostId: 'h1',
      provider: 'pi',
      actionKind: 'install',
      install: async () => {
        throw new Error('host unavailable');
      }
    })).resolves.toEqual({ ok: false, message: 'host unavailable' });

    await expect(installProviderCliOnMachine({
      hostId: 'h1',
      provider: 'pi',
      actionKind: 'install',
      install: async () => {
        throw 'nope';
      }
    })).resolves.toEqual({ ok: false, message: 'Install failed' });
  });
});
