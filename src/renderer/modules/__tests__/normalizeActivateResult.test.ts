import { describe, expect, it, vi } from 'vitest';
import { normalizeActivateResult } from '../loader';

describe('normalizeActivateResult', () => {
  it('wraps a bare function component as { panel } — never a settings page', () => {
    const Panel = () => null;
    const out = normalizeActivateResult(Panel);
    expect(out).toEqual({ panel: Panel });
    expect(out.settingsPanel).toBeUndefined();
    expect(out.background).toBeUndefined();
    expect(out.commands).toBeUndefined();
    expect(out.navBadge).toBeUndefined();
  });

  it('passes an ActivateResult object through, preserving panel/settingsPanel/background/commands/navBadge', () => {
    const Panel = () => null;
    const Settings = () => null;
    const Background = () => null;
    const commands = vi.fn();
    const navBadge = vi.fn();
    const out = normalizeActivateResult({ panel: Panel, settingsPanel: Settings, background: Background, commands, navBadge });
    expect(out).toEqual({ panel: Panel, settingsPanel: Settings, background: Background, commands, navBadge });
  });

  it('forwards a settings-only ActivateResult ({ settingsPanel }) — valid without a panel', () => {
    const Settings = () => null;
    const out = normalizeActivateResult({ settingsPanel: Settings });
    expect(out).toEqual({ settingsPanel: Settings });
    expect(out.panel).toBeUndefined();
    // The loader's accept test (mirrored): at least one extension point present.
    const contributes =
      typeof out.panel === 'function' ||
      (typeof out.panel === 'object' && out.panel !== null) ||
      typeof out.settingsPanel === 'function' ||
      (typeof out.settingsPanel === 'object' && out.settingsPanel !== null) ||
      typeof out.commands === 'function' ||
      typeof out.navBadge === 'function';
    expect(contributes).toBe(true);
  });

  it('accepts an exotic object component ($$typeof) nested under result.settingsPanel', () => {
    const memoLike = { $$typeof: Symbol.for('react.memo') };
    const out = normalizeActivateResult({ settingsPanel: memoLike });
    expect(out.settingsPanel).toBe(memoLike);
  });

  it('accepts function and exotic object components nested under result.background', () => {
    const Background = () => null;
    const memoLike = { $$typeof: Symbol.for('react.memo') };
    expect(normalizeActivateResult({ background: Background }).background).toBe(Background);
    expect(normalizeActivateResult({ background: memoLike }).background).toBe(memoLike);
  });

  it('reads a partial ActivateResult (commands/navBadge only, no panel)', () => {
    const commands = () => [];
    const out = normalizeActivateResult({ commands });
    expect(out.panel).toBeUndefined();
    expect(out.commands).toBe(commands);
    expect(out.navBadge).toBeUndefined();
  });

  // A commands-only (panel-less) result is a VALID contribution, not an empty
  // one. normalizeActivateResult yields { commands, panel: undefined }; the
  // loader guard (loadExtensionModule) treats this as "contributes" — because
  // commands is a function — and lets the module through with panel: undefined
  // (ModulePanelHost then renders the .module-no-panel placeholder). The guard
  // only error-surfaces a result with NO panel AND NO commands AND NO navBadge.
  it('locks the commands-only shape the loader must accept (not reject as empty)', () => {
    const commands = () => [{ id: 'ping', label: 'Hello: ping', run: () => {} }];
    const out = normalizeActivateResult({ commands });
    // Exactly { commands, panel: undefined } — no panel key value, badge absent.
    expect(out).toEqual({ commands });
    expect('panel' in out ? out.panel : undefined).toBeUndefined();
    // The loader's accept test: at least one extension point present.
    const contributes =
      typeof out.panel === 'function' ||
      (typeof out.panel === 'object' && out.panel !== null) ||
      typeof out.settingsPanel === 'function' ||
      (typeof out.settingsPanel === 'object' && out.settingsPanel !== null) ||
      typeof out.commands === 'function' ||
      typeof out.navBadge === 'function';
    expect(contributes).toBe(true);
  });

  it('a fully-empty object is NOT a contribution (loader error-surfaces it)', () => {
    const out = normalizeActivateResult({});
    expect(out).toEqual({});
    const contributes =
      typeof out.panel === 'function' ||
      (typeof out.panel === 'object' && out.panel !== null) ||
      typeof out.settingsPanel === 'function' ||
      (typeof out.settingsPanel === 'object' && out.settingsPanel !== null) ||
      typeof out.commands === 'function' ||
      typeof out.navBadge === 'function';
    expect(contributes).toBe(false);
  });

  it('keeps background-only results but does not make them visible contributions', () => {
    const Background = () => null;
    const out = normalizeActivateResult({ background: Background });
    expect(out).toEqual({ background: Background });
    const contributes =
      typeof out.panel === 'function' ||
      (typeof out.panel === 'object' && out.panel !== null) ||
      typeof out.settingsPanel === 'function' ||
      (typeof out.settingsPanel === 'object' && out.settingsPanel !== null) ||
      typeof out.commands === 'function' ||
      typeof out.navBadge === 'function';
    expect(contributes).toBe(false);
  });

  it('drops malformed fields rather than trusting them', () => {
    const out = normalizeActivateResult({
      panel: 'not-a-component',
      settingsPanel: 'nope',
      background: 'not-a-component',
      commands: 42,
      navBadge: { nope: true }
    });
    expect(out).toEqual({});
    expect(out.settingsPanel).toBeUndefined();
    expect(out.background).toBeUndefined();
  });

  it('treats an exotic object component ($$typeof) as the panel', () => {
    // Mimics what React.lazy/memo/forwardRef return: an object, not a function.
    const lazyLike = { $$typeof: Symbol.for('react.lazy'), _payload: {} };
    const out = normalizeActivateResult(lazyLike);
    expect(out.panel).toBe(lazyLike);
    // A bare exotic component never fabricates a settings page.
    expect(out.settingsPanel).toBeUndefined();
  });

  it('accepts an exotic object component nested under result.panel', () => {
    const memoLike = { $$typeof: Symbol.for('react.memo') };
    const out = normalizeActivateResult({ panel: memoLike });
    expect(out.panel).toBe(memoLike);
  });

  it('returns {} for garbage (null / string / number)', () => {
    expect(normalizeActivateResult(null)).toEqual({});
    expect(normalizeActivateResult(undefined)).toEqual({});
    expect(normalizeActivateResult('panel')).toEqual({});
    expect(normalizeActivateResult(123)).toEqual({});
  });
});
