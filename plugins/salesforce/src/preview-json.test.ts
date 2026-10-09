import { describe, expect, it } from 'vitest';
import { jsonPreview, splitElided } from '../lib/preview-json.js';
import { toolkitSummary } from '../lib/toolkit-adapter.js';

describe('jsonPreview', () => {
  it('keeps small payloads verbatim', () => {
    expect(jsonPreview({ action: 'deploy.start', tests: ['A'] })).toBe('{"action":"deploy.start","tests":["A"]}');
  });

  it('elides long arrays so oversized previews stay valid JSON', () => {
    const paths = Array.from({ length: 200 }, (_, index) => `/w/force-app/main/default/classes/Class${index}.cls`);
    const text = jsonPreview({ action: 'deploy.start', source_paths: paths }, 2_000);
    expect(text.length).toBeLessThanOrEqual(2_000);
    const parsed = JSON.parse(text) as { source_paths: string[] };
    expect(splitElided(parsed.source_paths)).toMatchObject({ more: 200 - parsed.source_paths.length + 1 });
    expect(parsed.source_paths[0]).toBe(paths[0]);
  });

  it('falls back to a plain cut when even one item per array is too large', () => {
    expect(jsonPreview({ body: 'x'.repeat(50) }, 20)).toHaveLength(20);
  });
});

describe('toolkitSummary', () => {
  it('names the call, the source path count and the org without the project id', () => {
    expect(toolkitSummary('sf_metadata', { action: 'deploy.start', source_paths: ['a', 'b'] }, 'dev')).toBe('sf_metadata deploy.start · 2 source paths on dev');
    expect(toolkitSummary('code_analyzer', { verb: 'run' })).toBe('code_analyzer run (local project)');
  });
});
