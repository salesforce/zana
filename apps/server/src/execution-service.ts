import { createHmac, randomBytes } from 'node:crypto';
import {
  ExecutionCommandSchema,
  ExecutionEventSchema,
  type ExecutionCommand,
  type ExecutionEvent,
  type SignedExecutionCommand
} from '@zana-ai/zcc-contracts/execution';
import { canonicalJson } from '@zana-ai/zcc-contracts/canonical-json';

export interface HostExecutionService {
  readonly token: string;
  readonly signingKey: string;
  execute(command: ExecutionCommand): Promise<ExecutionEvent[]>;
}

export interface HostExecutionServiceOptions {
  hostUrl: string;
  token?: string;
  signingKey?: string;
  now?: () => number;
  fetch?: typeof globalThis.fetch;
}

function sign(command: ExecutionCommand, signingKey: string): string {
  return createHmac('sha256', signingKey).update(canonicalJson(command)).digest('hex');
}

/**
 * Server-side authority adapter. Callers provide a fully resolved launch plan;
 * this service validates it before attaching the only proof the host accepts.
 */
export function createHostExecutionService(options: HostExecutionServiceOptions): HostExecutionService {
  const token = options.token ?? randomBytes(32).toString('base64url');
  const signingKey = options.signingKey ?? randomBytes(32).toString('base64url');
  const fetchImpl = options.fetch ?? globalThis.fetch;
  return {
    token,
    signingKey,
    async execute(input: ExecutionCommand): Promise<ExecutionEvent[]> {
      const command = ExecutionCommandSchema.parse(input);
      if (Date.parse(command.deadlineAt) <= (options.now ?? Date.now)()) {
        throw new Error('Refusing to issue an expired execution command');
      }
      const signed: SignedExecutionCommand = { command, signature: sign(command, signingKey) };
      const response = await fetchImpl(new URL('/commands', options.hostUrl), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(signed)
      });
      if (!response.ok) throw new Error(`Host daemon rejected execution: ${response.status}`);
      const body = await response.json() as { events?: unknown };
      if (!Array.isArray(body.events)) throw new Error('Host daemon returned an invalid event envelope');
      return body.events.map((event) => ExecutionEventSchema.parse(event));
    }
  };
}
