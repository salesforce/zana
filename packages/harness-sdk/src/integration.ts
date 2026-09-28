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
  /**
   * A provider whose CLI reads MCP from a discovered config FILE (OpenCode's
   * `OPENCODE_CONFIG` file-path env var) returns the env-var NAME to point at a
   * host-written file plus the file CONTENTS. This is the clobber-proof twin of
   * {@link mcpEnv}: inline-config env injection (OpenCode's
   * `OPENCODE_CONFIG_CONTENT`) is destroyed by any wrapper that OVERWRITES that
   * var (e.g. a telemetry shim), whereas a file referenced by a SEPARATE env var
   * survives — OpenCode deep-merges the file's `mcp` block back into the resolved
   * config regardless. The host owns the per-session temp-file lifecycle
   * (write / 0600 / reap / unlink) and points `<envVar>` at the path.
   */
  readonly mcpConfigFile?: Readonly<{ envVar: string; contents: string }>;
}

export interface HarnessIntegrationAdapter {
  configure(input: HarnessIntegrationRequest): HarnessIntegrationContribution;
}
