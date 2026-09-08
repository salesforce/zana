import { describe, expect, it } from 'vitest';
import { enforcePluginCliOutputLimit, PLUGIN_CLI_OUTPUT_MAX_BYTES } from './server.js';

describe('enforcePluginCliOutputLimit', () => {
  it('counts UTF-8 bytes without requiring Node globals', () => {
    const oversized = '€'.repeat(Math.floor(PLUGIN_CLI_OUTPUT_MAX_BYTES / 3) + 1);
    const result = enforcePluginCliOutputLimit({ exitCode: 0, stdout: oversized });

    expect(result.error).toMatchObject({
      code: 'plugin_cli_output_too_large',
      stdoutBytes: new TextEncoder().encode(oversized).byteLength
    });
  });

  it('preserves output at the byte limit', () => {
    const stdout = 'x'.repeat(PLUGIN_CLI_OUTPUT_MAX_BYTES);

    expect(enforcePluginCliOutputLimit({ exitCode: 0, stdout })).toEqual({
      exitCode: 0,
      stdout,
      stderr: ''
    });
  });

  it('counts a surrogate pair split at an internal chunk boundary once', () => {
    const stdout = `${'x'.repeat((16 * 1024) - 1)}😀`;
    const stderr = 'y'.repeat(PLUGIN_CLI_OUTPUT_MAX_BYTES);
    const result = enforcePluginCliOutputLimit({ exitCode: 0, stdout, stderr });

    expect(result.error).toMatchObject({
      stdoutBytes: new TextEncoder().encode(stdout).byteLength,
      stderrBytes: PLUGIN_CLI_OUTPUT_MAX_BYTES
    });
  });
});
