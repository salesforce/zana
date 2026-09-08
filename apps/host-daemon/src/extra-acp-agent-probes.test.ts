import { describe, expect, it } from 'vitest';
import { extraInstalledMap } from './extra-acp-agent-probes.js';

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
