import { describe, expect, it, vi } from 'vitest';
import { EXTRA_ACP_AGENT_PROBES, extraInstalledMap, probeExtraAcpAgents } from './extra-acp-agent-probes.js';

const run = vi.hoisted(() => vi.fn());
vi.mock('./provider-cli-health.js', () => ({ runProviderCliCommand: run }));

it('uses bounded portable probes and distinguishes missing and failing agents', async () => {
  run.mockImplementation(async ({ args }: { args: string[] }) => ({
    exitCode: args[0] === '--help' ? 0 : 1,
    errorMessage: null
  }));
  expect(await probeExtraAcpAgents()).toEqual([
    { providerId: 'acp-omp', installed: false },
    { providerId: 'acp-grok', installed: false },
    { providerId: 'acp-hermes-agent', installed: false },
    { providerId: 'acp-mastracode', installed: true }
  ]);
  expect(run).toHaveBeenCalledWith(expect.objectContaining({ args: ['--help'], timeoutMs: 8000 }), expect.objectContaining({ PATH: expect.any(String) }));
  run.mockResolvedValue({ exitCode: null, errorMessage: 'ENOENT' });
  expect((await probeExtraAcpAgents()).every((row) => !row.installed)).toBe(true);
});

describe('extraInstalledMap', () => {
  it('indexes extra ACP probe rows by provider id', () => {
    expect(extraInstalledMap([
      { providerId: 'acp-omp', installed: false },
      { providerId: 'acp-grok', installed: true }
    ])).toEqual({
      'acp-omp': false,
      'acp-grok': true
    });
  });
});

describe('EXTRA_ACP_AGENT_PROBES', () => {
  it('probes Mastra Code with --help because --version is not native', () => {
    expect(EXTRA_ACP_AGENT_PROBES).toEqual(expect.arrayContaining([
      expect.objectContaining({
        providerId: 'acp-mastracode',
        binary: 'mastracode',
        versionArgs: ['--help']
      })
    ]));
  });
});
