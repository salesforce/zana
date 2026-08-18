/** Provider-neutral host integrations rendered by a harness into native syntax. */

export interface HarnessMcpConnection {
  readonly url: string;
}

export interface HarnessLifecycleEndpoints {
  readonly stop?: string;
  readonly blocked?: string;
  readonly unblocked?: string;
  readonly firstPrompt?: string;
  readonly subagentStart?: string;
  readonly subagentStop?: string;
}

export interface HarnessIntegrationRequest {
  /** Profile is host-validated before the adapter receives it. */
  readonly profile: string;
  readonly mcp?: HarnessMcpConnection;
  readonly guidance?: string;
  readonly lifecycle?: HarnessLifecycleEndpoints;
  readonly auth?: Readonly<{ baseUrl?: string; token?: string }>;
}

/**
 * Native material returned to the host. Channels preserve the host's observed
 * argv/env precedence rather than making a provider rely on object-key order.
 */
export interface HarnessIntegrationContribution {
  readonly mcpArgs?: readonly string[];
  readonly guidanceArgs?: readonly string[];
  readonly hookArgs?: readonly string[];
  readonly authArgs?: readonly string[];
  readonly authEnv?: Readonly<Record<string, string>>;
  readonly mcpEnv?: Readonly<Record<string, string>>;
}

export interface HarnessIntegrationAdapter {
  configure(input: HarnessIntegrationRequest): HarnessIntegrationContribution;
}
