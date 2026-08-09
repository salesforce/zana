import { describe, it, expect } from 'vitest';
import { buildOptionList } from '../HarnessOptionSelect';
import { harnessOptions } from '@shared/launch-provider';

/**
 * The generic picker's list-assembly (Phase 4, T4.2) — pure, so unit-testable
 * without a DOM. Covers the two real caller modes: PersonaEditor (catalog owns
 * its `default`, no sentinel) and ProjectTab (`Use default` sentinel + drop the
 * catalog's own `default`).
 */
describe('buildOptionList', () => {
  const codexModels = harnessOptions('codex').filter((o) => o.role === 'model');

  it('PersonaEditor mode: renders the catalog verbatim (default entry included)', () => {
    const list = buildOptionList({ options: codexModels });
    expect(list.map((o) => o.id)).toEqual(codexModels.map((o) => o.id));
    expect(list[0].id).toBe('default'); // codex catalog leads with `default`
  });

  it('empty catalog falls back to a lone Default (disabled-axis case)', () => {
    const list = buildOptionList({ options: [] });
    expect(list).toEqual([{ id: 'default', label: 'Default' }]);
  });

  it('ProjectTab mode: prepends the sentinel and drops the catalog default', () => {
    const list = buildOptionList({
      options: codexModels,
      sentinel: { id: '', label: 'Use default' },
      dropDefaultId: true
    });
    expect(list[0]).toEqual({ id: '', label: 'Use default' });
    // The catalog's own `default` is gone; no duplicate empty-meaning options.
    expect(list.map((o) => o.id)).not.toContain('default');
    expect(list.filter((o) => o.id === '').length).toBe(1);
  });

  it('a catalog entry duplicating the sentinel id is dropped (no double row)', () => {
    const list = buildOptionList({
      options: [{ id: '', label: 'catalog empty' }, { id: 'x', label: 'X' }],
      sentinel: { id: '', label: 'Use default' }
    });
    expect(list.filter((o) => o.id === '').length).toBe(1);
    expect(list.find((o) => o.id === '')?.label).toBe('Use default');
  });

  it('sentinel WITHOUT dropDefaultId keeps the catalog default (permission-mode case)', () => {
    const perm = harnessOptions('claude').filter((o) => o.role === 'permissionMode');
    const list = buildOptionList({ options: perm, sentinel: { id: '', label: 'Use default' } });
    expect(list[0].id).toBe(''); // sentinel first
    expect(list.map((o) => o.id)).toContain('default'); // catalog default retained
  });
});
