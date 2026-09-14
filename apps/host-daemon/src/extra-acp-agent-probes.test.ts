import { describe, expect, it } from 'vitest';
import { EXTRA_ACP_AGENT_PROBES, extraInstalledMap } from './extra-acp-agent-probes.js';

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
