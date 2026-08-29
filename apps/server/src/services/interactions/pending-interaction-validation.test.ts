import { describe, expect, it } from 'vitest';
import type { PendingInteraction, PendingInteractionResolution } from '@zana-ai/zcc-domain/thread-runtime';
import { ThreadCreateError } from '../../http/thread-create.js';
import {
  pendingInteractionResolutionEquals,
  validatePendingInteractionResolution
} from './pending-interaction-validation.js';

function commandInteraction(overrides?: Partial<PendingInteraction>): PendingInteraction {
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
        command: 'git status',
        cwd: '/tmp',
        actions: [],
        sessionGrant: {
          network: { enabled: true },
          fileSystem: { read: ['/tmp'], write: [] }
        }
      }
    },
    resolution: null,
    statusReason: null,
    createdAt: 1,
    resolvedAt: null,
    ...overrides
  };
}

function questionInteraction(): PendingInteraction {
  return commandInteraction({
    payload: {
      kind: 'user_question',
      questions: [{
        id: 'q1',
        prompt: 'Continue?',
        multiSelect: false,
        allowFreeText: true,
        options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]
      }]
    }
  });
}

function expectInvalid(interaction: PendingInteraction, resolution: PendingInteractionResolution): void {
  expect(() => validatePendingInteractionResolution(interaction, resolution)).toThrow(ThreadCreateError);
}

describe('validatePendingInteractionResolution', () => {
  it('accepts deny and matching session grants', () => {
    const interaction = commandInteraction();
    expect(() => validatePendingInteractionResolution(interaction, { decision: 'deny' })).not.toThrow();
    expect(() => validatePendingInteractionResolution(interaction, {
      decision: 'allow_once',
      grantedPermissions: null
    })).not.toThrow();
    expect(() => validatePendingInteractionResolution(interaction, {
      decision: 'allow_for_session',
      grantedPermissions: {
        network: { enabled: true },
        fileSystem: { read: ['/tmp'], write: [] }
      }
    })).not.toThrow();
  });

  it('rejects plugin resolve, mismatched grants, and missing session grants', () => {
    expectInvalid({
      ...commandInteraction(),
      origin: { kind: 'plugin', pluginId: 'ask-user', rendererId: 'form' },
      payload: { kind: 'plugin', title: 'Ask', data: {} }
    }, { decision: 'deny' });
    expectInvalid(commandInteraction(), {
      decision: 'allow_for_session',
      grantedPermissions: null
    });
    expectInvalid(commandInteraction(), {
      decision: 'allow_for_session',
      grantedPermissions: { network: { enabled: false }, fileSystem: null }
    });
    expectInvalid(commandInteraction({
      payload: {
        kind: 'approval',
        reason: 'grant',
        availableDecisions: ['allow_once', 'deny'],
        subject: {
          kind: 'permission_grant',
          itemId: 'item-g',
          toolName: 'Bash',
          permissions: { network: { enabled: true }, fileSystem: null }
        }
      }
    }), { decision: 'allow_once', grantedPermissions: null });
  });

  it('validates user-question answers', () => {
    const interaction = questionInteraction();
    expect(() => validatePendingInteractionResolution(interaction, {
      kind: 'user_answer',
      answers: { q1: { selected: ['yes'] } }
    })).not.toThrow();
    expectInvalid(interaction, { decision: 'deny' });
    expectInvalid(interaction, { kind: 'user_answer', answers: { q2: { selected: ['yes'] } } });
    expectInvalid(interaction, { kind: 'user_answer', answers: { q1: { selected: ['yes', 'yes'] } } });
    expectInvalid(interaction, { kind: 'user_answer', answers: { q1: { selected: ['yes', 'no'] } } });
    expectInvalid(interaction, { kind: 'user_answer', answers: { q1: { selected: ['maybe'] } } });
    expectInvalid(interaction, { kind: 'user_answer', answers: { q1: { selected: [], freeText: '   ' } } });
    expectInvalid(interaction, { kind: 'user_answer', answers: { q1: { selected: [] } } });
    expectInvalid(commandInteraction(), {
      kind: 'user_answer',
      answers: { q1: { selected: ['yes'] } }
    });
  });
});

describe('pendingInteractionResolutionEquals', () => {
  it('compares deny, grants, plugin, and question answers', () => {
    expect(pendingInteractionResolutionEquals({ decision: 'deny' }, { decision: 'deny' })).toBe(true);
    expect(pendingInteractionResolutionEquals(
      { decision: 'allow_once', grantedPermissions: null },
      { decision: 'allow_once', grantedPermissions: null }
    )).toBe(true);
    expect(pendingInteractionResolutionEquals(
      { decision: 'allow_once', grantedPermissions: { network: { enabled: true }, fileSystem: { read: ['a'], write: [] } } },
      { decision: 'allow_once', grantedPermissions: { network: { enabled: true }, fileSystem: { read: ['a'], write: [] } } }
    )).toBe(true);
    expect(pendingInteractionResolutionEquals(
      { kind: 'plugin_submitted' },
      { kind: 'plugin_submitted' }
    )).toBe(true);
    expect(pendingInteractionResolutionEquals(
      { kind: 'user_answer', answers: { q1: { selected: ['yes'], freeText: 'ok' } } },
      { kind: 'user_answer', answers: { q1: { selected: ['yes'], freeText: 'ok' } } }
    )).toBe(true);
    expect(pendingInteractionResolutionEquals({ decision: 'deny' }, { kind: 'plugin_submitted' })).toBe(false);
    expect(pendingInteractionResolutionEquals(null, { decision: 'deny' })).toBe(false);
  });
});
