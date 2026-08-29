import { z } from 'zod';
import {
  HOST_RPC_PROTOCOL_VERSION,
  HostRpcCommandSchema,
  parseHostRpcResult,
  type HostRpcResponseMessage
} from '@zana-ai/zcc-contracts/host-rpc';
import { dispatchHostCommand, type CommandRuntime } from './command-dispatch.js';
import { HostCommandError } from './host-command-error.js';

const LooseRequestSchema = z.object({
  type: z.literal('host-rpc.request'),
  protocolVersion: z.number(),
  requestId: z.string().min(1),
  command: z.object({ type: z.string() }).passthrough()
});

export async function handleHostRpcRequest(
  runtime: CommandRuntime,
  raw: unknown
): Promise<HostRpcResponseMessage> {
  const request = LooseRequestSchema.safeParse(raw);
  if (!request.success) {
    return {
      type: 'host-rpc.response',
      protocolVersion: HOST_RPC_PROTOCOL_VERSION,
      requestId: typeof (raw as { requestId?: string })?.requestId === 'string'
        ? (raw as { requestId: string }).requestId
        : 'unknown',
      ok: false,
      error: { code: 'invalid_request', message: 'invalid host-rpc request' }
    };
  }
  if (request.data.protocolVersion !== HOST_RPC_PROTOCOL_VERSION) {
    return {
      type: 'host-rpc.response',
      protocolVersion: HOST_RPC_PROTOCOL_VERSION,
      requestId: request.data.requestId,
      ok: false,
      error: { code: 'protocol_mismatch', message: 'incompatible host-rpc protocol version' }
    };
  }
  const command = HostRpcCommandSchema.safeParse(request.data.command);
  if (!command.success) {
    return {
      type: 'host-rpc.response',
      protocolVersion: HOST_RPC_PROTOCOL_VERSION,
      requestId: request.data.requestId,
      ok: false,
      error: { code: 'unknown_command', message: 'unknown or invalid command type' }
    };
  }
  try {
    const result = await dispatchHostCommand(runtime, command.data);
    return {
      type: 'host-rpc.response',
      protocolVersion: HOST_RPC_PROTOCOL_VERSION,
      requestId: request.data.requestId,
      ok: true,
      commandType: command.data.type,
      result: parseHostRpcResult(command.data.type, result)
    };
  } catch (error) {
    const code = error instanceof HostCommandError ? error.code : 'internal';
    const message = error instanceof Error ? error.message : String(error);
    return {
      type: 'host-rpc.response',
      protocolVersion: HOST_RPC_PROTOCOL_VERSION,
      requestId: request.data.requestId,
      ok: false,
      commandType: command.data.type,
      error: { code, message }
    };
  }
}
