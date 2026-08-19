import { createHmac, randomBytes } from 'node:crypto';
import { canonicalJson } from '@zana-ai/zcc-contracts/canonical-json';
import {
  TerminalHostCommandSchema,
  TerminalHostEventSchema,
  type TerminalHostCommand,
  type TerminalHostEvent,
  type SignedTerminalHostCommand
} from '@zana-ai/zcc-contracts/terminal-execution';

export interface TerminalExecutionService {
  readonly token: string;
  readonly signingKey: string;
  execute(command: TerminalHostCommand): Promise<TerminalHostEvent[]>;
}

export interface CreateTerminalExecutionServiceOptions {
  hostUrl: string;
  token?: string;
  signingKey?: string;
  now?: () => number;
  fetch?: typeof globalThis.fetch;
}

export function signTerminalCommand(command: TerminalHostCommand, signingKey: string): SignedTerminalHostCommand {
  return {
    command: TerminalHostCommandSchema.parse(command),
    signature: createHmac('sha256', signingKey).update(canonicalJson(command)).digest('hex')
  };
}

/**
 * The server adapter is the only component that signs terminal commands. It is
 * intentionally transport-focused: project/path/profile resolution must finish
 * before a caller can construct this final host-facing command.
 */
export function createTerminalExecutionService(options: CreateTerminalExecutionServiceOptions): TerminalExecutionService {
  const token = options.token ?? randomBytes(32).toString('base64url');
  const signingKey = options.signingKey ?? randomBytes(32).toString('base64url');
  const fetchImpl = options.fetch ?? globalThis.fetch;
  return {
    token,
    signingKey,
    async execute(input: TerminalHostCommand): Promise<TerminalHostEvent[]> {
      const command = TerminalHostCommandSchema.parse(input);
      if (Date.parse(command.deadlineAt) <= (options.now ?? Date.now)()) {
        throw new Error('Refusing to issue an expired terminal command');
      }
      const signed = signTerminalCommand(command, signingKey);
      const response = await fetchImpl(new URL('/terminals', options.hostUrl), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(signed)
      });
      if (!response.ok) throw new Error(`Host daemon rejected terminal command: ${response.status}`);
      const body = await response.json() as { events?: unknown };
      if (!Array.isArray(body.events)) throw new Error('Host daemon returned an invalid terminal event envelope');
      return body.events.map((event) => TerminalHostEventSchema.parse(event));
    }
  };
}
