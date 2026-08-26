/**
 * Core `zcc` CLI top-level command names (plus built-in help).
 * Plugin CLI commands may not shadow these. Maintained by hand and checked
 * against the real CLI program by packages/cli/src/lib/plugin-cli-proxy.test.ts.
 */
export const RESERVED_ZCC_CLI_COMMANDS: readonly string[] = [
  'agent',
  'followup',
  'help',
  'inbox',
  'marketplace',
  'personas',
  'plugin',
  'projects',
  'run',
  'schedule',
  'status',
  'team',
  'term'
];

/** @deprecated Use RESERVED_ZCC_CLI_COMMANDS. */
export const RESERVED_BB_CLI_COMMANDS = RESERVED_ZCC_CLI_COMMANDS;

export const PLUGIN_CLI_COMMAND_NAME_PATTERN = /^[a-z0-9-]+$/;
