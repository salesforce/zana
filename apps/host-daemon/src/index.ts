import { ExecutionCommandSchema, type ExecutionEvent } from '@zana-ai/zcc-contracts/execution';
import { CommandIdSchema } from '@zana-ai/zcc-domain';

/**
 * Validates the wire format before execution. The server is still responsible
 * for path, profile, and grant authorization before it issues the command.
 */
export function rejectMalformedExecutionCommand(input: unknown): ExecutionEvent | null {
  const parsed = ExecutionCommandSchema.safeParse(input);
  if (parsed.success) return null;
  const candidate = typeof input === 'object' && input !== null && 'commandId' in input
    ? String(input.commandId)
    : '';
  const commandId = CommandIdSchema.safeParse(candidate).success
    ? candidate
    : '00000000-0000-0000-0000-000000000000';
  return { kind: 'rejected', commandId, reason: 'Invalid execution command' };
}

export * from './daemon.js';
export * from './terminal-manager.js';
export * from './local-pty-host.js';
