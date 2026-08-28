/**
 * Core `zcc` CLI top-level command names (plus built-in help).
 * Plugin CLI commands may not shadow these. Maintained by hand and checked
 * against the real CLI program by packages/cli/src/lib/plugin-cli-proxy.test.ts
 * and packages/cli/src/lib/cli-guide-and-skill.test.ts.
 */
export const RESERVED_ZCC_CLI_COMMANDS: readonly string[] = [
  'agent',
  'environment',
  'followup',
  'guide',
  'help',
  'inbox',
  'machine',
  'marketplace',
  'personas',
  'plugin',
  'project',
  'projects',
  'run',
  'schedule',
  'settings',
  'skill',
  'status',
  'team',
  'term',
  'terminal',
  'thread'
];

/** @deprecated Use RESERVED_ZCC_CLI_COMMANDS. */
export const RESERVED_BB_CLI_COMMANDS = RESERVED_ZCC_CLI_COMMANDS;

export const PLUGIN_CLI_COMMAND_NAME_PATTERN = /^[a-z0-9-]+$/;
