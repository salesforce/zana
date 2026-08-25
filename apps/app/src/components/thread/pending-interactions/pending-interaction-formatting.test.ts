import { describe, expect, it } from 'vitest';
import type { PendingInteraction } from '@zana-ai/zcc-domain/thread-runtime';
import {
  approvalDecisionLabel,
  approvalDecisionTone,
  buildPendingInteractionApprovalResolution,
  formatPendingInteractionSubjectDetailLines,
  pendingInteractionSubjectDetails,
  shouldShowPendingInteractionReason,
  summarizePendingInteractionRequestedPermissions
} from './pending-interaction-formatting.js';

function commandInteraction(): PendingInteraction {
  return {
    id: 'pint_1',
    threadId: 'thr-1',
    turnId: 'turn-1',
    providerId: 'claude-code',
    providerThreadId: 'prov-1',
    providerRequestId: 'req-1',
    origin: {
      kind: 'provider',
      providerId: 'claude-code',
      providerThreadId: 'prov-1',
      providerRequestId: 'req-1'
    },
    status: 'pending',
    payload: {
      kind: 'approval',
      reason: 'Needs approval',
      availableDecisions: ['allow_once', 'allow_for_session', 'deny'],
      subject: {
        kind: 'command',
        itemId: 'item-1',
        command: 'git push',
        cwd: '/tmp/proj',
        actions: [{ type: 'read', command: 'cat', name: 'readme', path: 'README.md' }],
        sessionGrant: {
          network: { enabled: true },
          fileSystem: { read: ['/tmp/proj'], write: [] }
        }
      }
    },
    resolution: null,
    statusReason: null,
    createdAt: 1,
    resolvedAt: null
  };
}

describe('pending interaction formatting', () => {
  it('formats command subject details', () => {
    expect(formatPendingInteractionSubjectDetailLines(commandInteraction())).toEqual([
      'Command: git push',
      'Cwd: /tmp/proj',
      'Action: Read README.md',
      'Session grant: Network access, Read 1 path'
    ]);
    expect(pendingInteractionSubjectDetails(commandInteraction())).toEqual([
      { kind: 'code', label: 'Command', value: 'git push' },
      { kind: 'text', label: 'Cwd', value: '/tmp/proj' },
      { kind: 'text', label: 'Action', value: 'Read README.md' },
      { kind: 'text', label: 'Session grant', value: 'Network access, Read 1 path' }
    ]);
  });

  it('omits unknown actions that repeat the command and duplicate reasons', () => {
    const command = 'for d in */ ; do echo "$d"; done';
    const interaction = {
      ...commandInteraction(),
      payload: {
        kind: 'approval' as const,
        reason: command,
        availableDecisions: ['allow_once', 'deny'] as const,
        subject: {
          kind: 'command' as const,
          itemId: 'item-1',
          command,
          cwd: null,
          actions: [
            { type: 'unknown' as const, command: `  ${command}  ` },
            { type: 'unknown' as const, command: 'ls' }
          ],
          sessionGrant: null
        }
      }
    };
    expect(pendingInteractionSubjectDetails(interaction)).toEqual([
      { kind: 'code', label: 'Command', value: command },
      { kind: 'code', label: 'Action', value: 'ls' }
    ]);
    expect(shouldShowPendingInteractionReason(command, pendingInteractionSubjectDetails(interaction))).toBe(false);
    expect(shouldShowPendingInteractionReason('Needs approval', pendingInteractionSubjectDetails(interaction))).toBe(true);
    expect(shouldShowPendingInteractionReason('  ', pendingInteractionSubjectDetails(interaction))).toBe(false);
  });

  it('builds allow-once without a session grant and deny without permissions', () => {
    const interaction = commandInteraction();
    expect(buildPendingInteractionApprovalResolution(interaction, 'allow_once')).toEqual({
      decision: 'allow_once',
      grantedPermissions: null
    });
    expect(buildPendingInteractionApprovalResolution(interaction, 'deny')).toEqual({
      decision: 'deny'
    });
    expect(buildPendingInteractionApprovalResolution(interaction, 'allow_for_session')).toEqual({
      decision: 'allow_for_session',
      grantedPermissions: interaction.payload.kind === 'approval' && interaction.payload.subject.kind === 'command'
        ? interaction.payload.subject.sessionGrant
        : null
    });
  });

  it('labels approval decisions', () => {
    expect(approvalDecisionLabel('allow_once')).toBe('Allow once');
    expect(approvalDecisionLabel('allow_for_session')).toBe('Allow for session');
    expect(approvalDecisionLabel('deny')).toBe('Deny');
    expect(approvalDecisionTone('allow_once')).toBe('primary');
    expect(approvalDecisionTone('allow_for_session')).toBe('secondary');
    expect(approvalDecisionTone('deny')).toBe('ghost');
  });

  it('formats file-change, permission-grant, plan, and question details', () => {
    const base = commandInteraction();
    expect(formatPendingInteractionSubjectDetailLines({
      ...base,
      payload: {
        kind: 'approval',
        reason: 'edit',
        availableDecisions: ['allow_once', 'deny'],
        subject: {
          kind: 'file_change',
          itemId: 'item-2',
          writeScope: '/tmp/proj',
          sessionGrant: null
        }
      }
    })).toEqual(['Item: item-2', 'Write root: /tmp/proj']);
    expect(formatPendingInteractionSubjectDetailLines({
      ...base,
      payload: {
        kind: 'approval',
        reason: 'grant',
        availableDecisions: ['allow_once', 'deny'],
        subject: {
          kind: 'permission_grant',
          itemId: 'item-3',
          toolName: 'Bash',
          permissions: {
            network: { enabled: true },
            fileSystem: { read: ['/tmp/a', '/tmp/b'], write: ['/tmp/out'] }
          }
        }
      }
    })).toEqual([
      'Tool: Bash',
      'Permission: Network access',
      'Permission: Read 2 paths',
      'Permission: Write 1 path'
    ]);
    expect(formatPendingInteractionSubjectDetailLines({
      ...base,
      payload: {
        kind: 'approval',
        reason: 'plan',
        availableDecisions: ['allow_once', 'deny'],
        subject: { kind: 'plan', itemId: 'item-4', plan: 'Ship it', planFilePath: '/tmp/plan.md' }
      }
    })).toEqual(['Plan file: /tmp/plan.md']);
    expect(formatPendingInteractionSubjectDetailLines({
      ...base,
      payload: {
        kind: 'user_question',
        questions: [{
          id: 'q1',
          prompt: 'Continue?',
          multiSelect: false,
          allowFreeText: false,
          options: [{ value: 'yes', label: 'Yes' }]
        }]
      }
    })).toEqual(['Continue?']);
    expect(pendingInteractionSubjectDetails({
      ...base,
      payload: {
        kind: 'user_question',
        questions: [{
          id: 'q1',
          prompt: 'Continue?',
          multiSelect: false,
          allowFreeText: false,
          options: [{ value: 'yes', label: 'Yes' }]
        }]
      }
    })).toEqual([{ kind: 'text', label: 'Question', value: 'Continue?' }]);
    expect(formatPendingInteractionSubjectDetailLines({
      ...base,
      origin: { kind: 'plugin', pluginId: 'ask-user', rendererId: 'form' },
      payload: { kind: 'plugin', title: 'Confirm', data: { n: 1 } }
    })).toEqual([]);
  });

  it('formats command action variants and macOS permission summaries', () => {
    const interaction = commandInteraction();
    expect(formatPendingInteractionSubjectDetailLines({
      ...interaction,
      payload: {
        kind: 'approval',
        reason: 'Needs approval',
        availableDecisions: ['allow_once', 'deny'],
        subject: {
          kind: 'command',
          itemId: 'item-1',
          command: 'find',
          cwd: null,
          actions: [
            { type: 'listFiles', command: 'ls', path: '/tmp' },
            { type: 'listFiles', command: 'ls', path: null },
            { type: 'search', command: 'rg', query: 'TODO', path: '/src' },
            { type: 'search', command: 'rg', query: null, path: '/src' },
            { type: 'search', command: 'rg', query: null, path: null },
            { type: 'unknown', command: 'mystery' }
          ],
          sessionGrant: null
        }
      }
    })).toEqual([
      'Command: find',
      'Action: List files in /tmp',
      'Action: List files',
      'Action: Search for TODO in /src',
      'Action: Search in /src',
      'Action: Search files',
      'Action: mystery'
    ]);
    expect(summarizePendingInteractionRequestedPermissions({
      network: { enabled: false },
      fileSystem: null,
      macos: {
        accessibility: true,
        launchServices: true,
        calendar: true,
        reminders: true,
        preferences: 'read_only',
        contacts: 'read_write',
        automations: { kind: 'bundle_ids', bundleIds: ['com.apple.mail'] }
      }
    })).toEqual([
      'macOS accessibility',
      'macOS launch services',
      'macOS calendar',
      'macOS reminders',
      'macOS preferences (read only)',
      'macOS contacts (read write)',
      'macOS automation (1 app)'
    ]);
  });

  it('builds permission-grant resolutions with granted permissions', () => {
    const interaction = {
      ...commandInteraction(),
      payload: {
        kind: 'approval' as const,
        reason: 'grant',
        availableDecisions: ['allow_once', 'deny'] as const,
        subject: {
          kind: 'permission_grant' as const,
          itemId: 'item-3',
          toolName: 'Bash',
          permissions: {
            network: { enabled: true },
            fileSystem: { read: ['/tmp'], write: [] }
          }
        }
      }
    };
    expect(buildPendingInteractionApprovalResolution(interaction, 'allow_once')).toEqual({
      decision: 'allow_once',
      grantedPermissions: { network: { enabled: true }, fileSystem: { read: ['/tmp'], write: [] } }
    });
  });
});
