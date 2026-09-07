import { describe, expect, it } from 'vitest';
import { nextAcpModeSelection } from './acp-mode-selection.js';

const OPTIONS = [{ value: 'build' }, { value: 'doc-vault' }];

describe('nextAcpModeSelection', () => {
  it('leaves the pick unchanged when there is no provider default', () => {
    expect(nextAcpModeSelection({ current: undefined, selected: 'doc-vault', options: OPTIONS })).toBeUndefined();
  });

  it('initializes to the provider default when the user has not picked yet', () => {
    expect(nextAcpModeSelection({ current: 'build', selected: undefined, options: OPTIONS })).toBe('build');
  });

  it('keeps an explicit pick that is present in the advertised options', () => {
    expect(nextAcpModeSelection({ current: 'build', selected: 'doc-vault', options: OPTIONS })).toBeUndefined();
  });

  it('does NOT clobber a pick while options are momentarily empty (reload/in-flight window)', () => {
    // The regression: reloadThreadProviderModels clears the cached entry before
    // the refetch, so options briefly falls back to []. A valid doc-vault pick
    // must survive that window instead of reverting to the default build.
    expect(nextAcpModeSelection({ current: 'build', selected: 'doc-vault', options: [] })).toBeUndefined();
  });

  it('resets to the default when options are loaded and the pick is genuinely absent', () => {
    // e.g. after switching to a provider that does not advertise the old role.
    expect(nextAcpModeSelection({ current: 'build', selected: 'legacy-role', options: OPTIONS })).toBe('build');
  });
});
