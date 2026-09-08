import { describe, expect, it } from 'vitest';
import { overlayDiscoveredModels } from '../discovered-model-evidence.js';

describe('overlayDiscoveredModels', () => {
  it('stamps evidenceVersion and adds missing evidence rows per scope', () => {
    const existing = [
      { id: 'known', versionRange: '1.0.0', scope: 'local' as const, probe: 'p', observed: 'o', reviewedAt: '2026-01-01' }
    ];
    const { models, evidence } = overlayDiscoveredModels(
      [
        { id: 'known', label: 'Known', scope: ['local'] },
        { id: 'fresh', label: 'Fresh', scope: ['local'] }
      ],
      existing,
      '1.0.0',
      (id, scope) => ({ id, versionRange: '1.0.0', scope, probe: 'live', observed: 'ok', reviewedAt: '2026-01-01' })
    );
    expect(models.every((model) => model.evidenceVersion === '1.0.0')).toBe(true);
    expect(evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'known', scope: 'local' }),
      expect.objectContaining({ id: 'fresh', scope: 'local', probe: 'live' })
    ]));
    expect(evidence.filter((row) => row.id === 'known')).toHaveLength(1);
  });
});
