/** Provider-neutral host integrations rendered by a harness into native syntax. */

export interface HarnessMcpConnection {
  readonly url: string;
  /**
   * MCP server names the host asks this harness to DISABLE for the session
   * (deep-merged as `enabled:false` where the harness carries MCP through a
   * merged config, e.g. OpenCode's `OPENCODE_CONFIG_CONTENT`). Provider-neutral:
   * the concrete names are host-supplied config VALUES, never named in core.
   * Empty/absent leaves the session's discovered servers untouched.
   */
  readonly disabledServers?: readonly string[];
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
