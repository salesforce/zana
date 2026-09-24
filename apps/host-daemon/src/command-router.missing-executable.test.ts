import { describe, expect, it } from 'vitest';
import { BRIDGE_JSON_RPC_ERRORS } from '@zana-ai/zcc-provider-bridge-protocol';
import { JsonRpcResponseError } from '@zana-ai/zcc-provider-bridge-protocol/bridge-kit';
import { HOST_RPC_PROTOCOL_VERSION } from '@zana-ai/zcc-contracts/host-rpc';
import { handleHostRpcRequest } from './command-router.js';
import { HostCommandError } from './host-command-error.js';
import type { CommandRuntime } from './command-dispatch.js';

const bridgeLaunch = {
  pluginId: 'provider-codex',
  source: { kind: 'daemon-bundled' as const, id: 'codex' },
  capabilities: {
    supportsServiceTier: true,
    permissionModes: ['full'],
    supportsThreadArchive: false,
    supportsThreadRename: true,
    fork: 'checkpoint' as const
  }
};

function runtime(listModels: NonNullable<CommandRuntime['listModels']>): CommandRuntime {
  return {
    listModels
  } as CommandRuntime;
}

function listModelsRequest(requestId: string) {
  return {
    type: 'host-rpc.request' as const,
    protocolVersion: HOST_RPC_PROTOCOL_VERSION,
    requestId,
    command: {
      type: 'provider.list_models' as const,
      providerId: 'codex',
      bridgeLaunch
    }
  };
}

describe('handleHostRpcRequest missing executable mapping', () => {
  it('maps bridge MISSING_EXECUTABLE onto missing_executable without sniffing the message', async () => {
    const response = await handleHostRpcRequest(
      runtime(async () => {
        throw new JsonRpcResponseError(
          BRIDGE_JSON_RPC_ERRORS.MISSING_EXECUTABLE,
          'bb could not find the Codex CLI on this machine.'
        );
      }),
      listModelsRequest('req-1')
    );
    expect(response.ok).toBe(false);
    if (response.ok) throw new Error('expected failure');
    expect(response.error).toEqual({
      code: 'missing_executable',
      message: 'bb could not find the Codex CLI on this machine.'
    });
  });

  it('keeps prose under BRIDGE_ERROR as an internal failure for the host RPC', async () => {
    const response = await handleHostRpcRequest(
      runtime(async () => {
        throw new JsonRpcResponseError(
          BRIDGE_JSON_RPC_ERRORS.BRIDGE_ERROR,
          'bb could not find the Codex CLI on this machine.'
        );
      }),
      listModelsRequest('req-2')
    );
    expect(response.ok).toBe(false);
    if (response.ok) throw new Error('expected failure');
    expect(response.error.code).toBe('internal');
  });

  it('preserves HostCommandError codes', async () => {
    const response = await handleHostRpcRequest(
      runtime(async () => {
        throw new HostCommandError('unsupported', 'model listing is not available on this host');
      }),
      listModelsRequest('req-3')
    );
    expect(response.ok).toBe(false);
    if (response.ok) throw new Error('expected failure');
    expect(response.error.code).toBe('unsupported');
  });
});
