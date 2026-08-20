import { createHmac, randomBytes } from 'node:crypto';
import { canonicalJson } from '@zana-ai/zcc-contracts/canonical-json';
import {
  HOST_CONNECTION_PROTOCOL_VERSION,
  HostConnectionAckSchema,
  HostConnectionHelloSchema,
  TerminalHostCommandSchema,
  TerminalHostEventSchema,
  type TerminalHostBinding,
  type TerminalRequestCommand,
  type TerminalHostCommand,
  type TerminalHostEvent,
  type SignedTerminalHostCommand
} from '@zana-ai/zcc-contracts/terminal-execution';

export interface TerminalExecutionService {
  readonly token: string;
  readonly signingKey: string;
  readonly binding: TerminalHostBinding;
  connect(): Promise<number>;
  execute(command: TerminalRequestCommand): Promise<TerminalHostEvent[]>;
}

export interface CreateTerminalExecutionServiceOptions {
  hostUrl: string;
  token?: string;
  signingKey?: string;
  binding: TerminalHostBinding;
  now?: () => number;
  fetch?: typeof globalThis.fetch;
}

export function signTerminalCommand(command: TerminalHostCommand, signingKey: string): SignedTerminalHostCommand {
  return {
    command: TerminalHostCommandSchema.parse(command),
    signature: createHmac('sha256', signingKey).update(canonicalJson(command)).digest('hex')
  };
}

function signHostConnectionHello(
  hello: ReturnType<typeof HostConnectionHelloSchema.parse>,
  signingKey: string
) {
  return {
    hello: HostConnectionHelloSchema.parse(hello),
    signature: createHmac('sha256', signingKey).update(canonicalJson(hello)).digest('hex')
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
    binding: options.binding,
    async connect(): Promise<number> {
      const hello = HostConnectionHelloSchema.parse({
        protocolVersion: HOST_CONNECTION_PROTOCOL_VERSION,
        binding: options.binding,
        deadlineAt: new Date((options.now ?? Date.now)() + 5_000).toISOString()
      });
      const response = await fetchImpl(new URL('/connection', options.hostUrl), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(signHostConnectionHello(hello, signingKey))
      });
      if (!response.ok) throw new Error(`Host daemon rejected host connection: ${response.status}`);
      const acknowledgement = HostConnectionAckSchema.parse(await response.json());
      if (
        acknowledgement.binding.hostId !== options.binding.hostId ||
        acknowledgement.binding.instanceId !== options.binding.instanceId ||
        acknowledgement.binding.hostConnectionId !== options.binding.hostConnectionId
      ) throw new Error('Host daemon acknowledged a different host connection');
      return acknowledgement.leaseExpiresAt;
    },
    async execute(input: TerminalRequestCommand): Promise<TerminalHostEvent[]> {
      const command = TerminalHostCommandSchema.parse({ ...input, binding: options.binding });
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
      return body.events.map((event) => {
        const parsed = TerminalHostEventSchema.parse(event);
        if (
          parsed.binding.hostId !== options.binding.hostId ||
          parsed.binding.instanceId !== options.binding.instanceId ||
          parsed.binding.hostConnectionId !== options.binding.hostConnectionId
        ) throw new Error('Host daemon returned an event for a different host connection');
        return parsed;
      });
    }
  };
}
