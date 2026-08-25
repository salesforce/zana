import { describe, expect, it } from 'vitest';
import type { PendingInteractionCreate, PendingInteractionResolution } from '@zana-ai/zcc-domain/thread-runtime';
import type { HostDaemonInteractiveRequestResponse } from '@zana-ai/zcc-host-daemon-contract';
import {
  InteractiveRequestRegistry,
  InteractiveRequestRegistryError
} from './interactive-request-registry.js';

interface Deferred<TValue> {
  promise: Promise<TValue>;
  reject: (error: Error) => void;
  resolve: (value: TValue) => void;
}

function createDeferred<TValue>(): Deferred<TValue> {
  let resolveValue: (value: TValue) => void = () => {};
  let rejectValue: (error: Error) => void = () => {};
  const promise = new Promise<TValue>((resolve, reject) => {
    resolveValue = resolve;
    rejectValue = reject;
  });
  return { promise, reject: rejectValue, resolve: resolveValue };
}

function createCommandApprovalRequest(providerRequestId = 'request-registry'): PendingInteractionCreate {
  return {
    threadId: '11111111-1111-4111-8111-111111111111',
    turnId: 'turn_registry',
    providerId: 'codex',
    providerThreadId: 'provider-thread-registry',
    providerRequestId,
    payload: {
      kind: 'approval',
      subject: {
        kind: 'command',
        itemId: 'item-registry',
        command: 'git push',
        cwd: '/tmp/project',
        actions: [],
        sessionGrant: null
      },
      reason: 'Needs approval',
      availableDecisions: ['allow_once', 'deny']
    }
  };
}

function createCommandApprovalResolution(): PendingInteractionResolution {
  return { decision: 'allow_once', grantedPermissions: null };
}

describe('InteractiveRequestRegistry', () => {
  it('registers a provider request and resolves it from an interactive.resolve command', async () => {
    const request = createCommandApprovalRequest();
    const resolution = createCommandApprovalResolution();
    const registry = new InteractiveRequestRegistry({
      registerRequest: async () => ({
        outcome: 'created',
        interactionId: 'pint_registry',
        status: 'pending'
      })
    });
    const pending = registry.registerAndWait(request);
    registry.resolve({
      interactionId: 'pint_registry',
      providerId: request.providerId,
      providerRequestId: request.providerRequestId,
      providerThreadId: request.providerThreadId,
      resolution,
      threadId: request.threadId
    });
    await expect(pending).resolves.toEqual(resolution);
  });

  it('deduplicates registration retries for the same live provider request', async () => {
    const request = createCommandApprovalRequest();
    const registration = createDeferred<HostDaemonInteractiveRequestResponse>();
    const registrations: PendingInteractionCreate[] = [];
    const registry = new InteractiveRequestRegistry({
      registerRequest: async (registeredRequest) => {
        registrations.push(registeredRequest);
        return registration.promise;
      }
    });
    const first = registry.registerAndWait(request);
    const second = registry.registerAndWait(request);
    expect(registrations).toEqual([request]);
    registration.resolve({
      outcome: 'created',
      interactionId: 'pint_registry',
      status: 'pending'
    });
    const resolution = createCommandApprovalResolution();
    registry.resolve({
      interactionId: 'pint_registry',
      providerId: request.providerId,
      providerRequestId: request.providerRequestId,
      providerThreadId: request.providerThreadId,
      resolution,
      threadId: request.threadId
    });
    await expect(first).resolves.toEqual(resolution);
    await expect(second).resolves.toEqual(resolution);
  });

  it('ignores duplicate delivery after a command acknowledgement is retried', async () => {
    const request = createCommandApprovalRequest();
    const resolution = createCommandApprovalResolution();
    const registry = new InteractiveRequestRegistry({
      registerRequest: async () => ({
        outcome: 'created',
        interactionId: 'pint_registry',
        status: 'pending'
      })
    });
    const pending = registry.registerAndWait(request);
    const command = {
      interactionId: 'pint_registry',
      providerId: request.providerId,
      providerRequestId: request.providerRequestId,
      providerThreadId: request.providerThreadId,
      resolution,
      threadId: request.threadId
    };
    registry.resolve(command);
    registry.resolve(command);
    await expect(pending).resolves.toEqual(resolution);
  });

  it('rejects stale resolve commands that have no live provider request', () => {
    const request = createCommandApprovalRequest();
    const registry = new InteractiveRequestRegistry({
      registerRequest: async () => ({
        outcome: 'created',
        interactionId: 'pint_registry',
        status: 'pending'
      })
    });
    expect(() =>
      registry.resolve({
        interactionId: 'pint_registry',
        providerId: request.providerId,
        providerRequestId: request.providerRequestId,
        providerThreadId: request.providerThreadId,
        resolution: createCommandApprovalResolution(),
        threadId: request.threadId
      })
    ).toThrow(InteractiveRequestRegistryError);
  });

  it('rejects provider waits when server registration is rejected', async () => {
    const registry = new InteractiveRequestRegistry({
      registerRequest: async () => ({
        outcome: 'rejected',
        reason: 'Thread is already awaiting user interaction'
      })
    });
    await expect(registry.registerAndWait(createCommandApprovalRequest())).rejects.toMatchObject({
      code: 'interactive_request_rejected',
      message: 'Thread is already awaiting user interaction',
      name: 'InteractiveRequestRegistryError'
    });
  });

  it('posts interrupt on registration failure and rejects the waiter', async () => {
    const failures: string[] = [];
    const registry = new InteractiveRequestRegistry({
      registerRequest: async () => {
        throw new Error('server down');
      },
      onRegistrationFailure: ({ error }) => {
        failures.push(error.message);
      }
    });
    await expect(registry.registerAndWait(createCommandApprovalRequest())).rejects.toThrow('server down');
    expect(failures).toEqual(['server down']);
  });

  it('rejects provider waits when the provider exits', async () => {
    const request = createCommandApprovalRequest();
    const registry = new InteractiveRequestRegistry({
      registerRequest: async () => ({
        outcome: 'created',
        interactionId: 'pint_registry',
        status: 'pending'
      })
    });
    const pending = registry.registerAndWait(request);
    registry.interruptThreads({
      providerId: request.providerId,
      reason: 'Provider exited',
      threadIds: [request.threadId]
    });
    await expect(pending).rejects.toThrow('Provider exited');
  });
});
