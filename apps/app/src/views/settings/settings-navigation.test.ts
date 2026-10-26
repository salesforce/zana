import { describe, expect, it } from 'vitest';
import {
  SETTINGS_GROUPS,
  SETTINGS_SECTIONS,
  SETTINGS_SUBSECTIONS,
  visibleSettingsSections
} from '@/views/settings/settings-navigation';

describe('visibleSettingsSections', () => {
  it('returns the full list unchanged when nothing is hidden (empty set branch)', () => {
    const result = visibleSettingsSections(new Set());
    expect(result).toBe(SETTINGS_SECTIONS);
    expect(result).toHaveLength(SETTINGS_SECTIONS.length);
  });

  it('always includes the Peers section when nothing is hidden', () => {
    const peers = visibleSettingsSections(new Set()).find((s) => s.id === 'peers');
    expect(peers).toBeDefined();
    expect(peers?.group).toBe('remote');
  });

  it('keeps Peers visible even when other sections are hidden', () => {
    const result = visibleSettingsSections(new Set(['machines', 'experimental', 'about']));
    const ids = result.map((s) => s.id);
    expect(ids).toContain('peers');
    expect(ids).not.toContain('machines');
    expect(ids).not.toContain('experimental');
    expect(ids).not.toContain('about');
  });

  it('filters out Peers when it is explicitly hidden', () => {
    const result = visibleSettingsSections(new Set(['peers']));
    expect(result.map((s) => s.id)).not.toContain('peers');
    expect(result).toHaveLength(SETTINGS_SECTIONS.length - 1);
  });

  it('returns a filtered copy, not the shared constant, when a set is non-empty (filter branch)', () => {
    const result = visibleSettingsSections(new Set(['machines']));
    expect(result).not.toBe(SETTINGS_SECTIONS);
    expect(result.map((s) => s.id)).not.toContain('machines');
    expect(result).toHaveLength(SETTINGS_SECTIONS.length - 1);
    // Original untouched.
    expect(SETTINGS_SECTIONS.map((s) => s.id)).toContain('machines');
  });

  it('ignores unknown ids in the hidden set (no accidental removals)', () => {
    const result = visibleSettingsSections(new Set(['does-not-exist', 'also-missing']));
    expect(result.map((s) => s.id)).toEqual(SETTINGS_SECTIONS.map((s) => s.id));
  });

  it('removes every section when all ids are hidden (empty result edge case)', () => {
    const everyId = new Set(SETTINGS_SECTIONS.map((s) => s.id));
    expect(visibleSettingsSections(everyId)).toHaveLength(0);
  });

  it('hides exactly the requested machines/experimental combination and nothing else', () => {
    const hidden = new Set(['machines', 'experimental']);
    const result = visibleSettingsSections(hidden);
    expect(result).toHaveLength(SETTINGS_SECTIONS.length - 2);
    for (const section of SETTINGS_SECTIONS) {
      expect(result.some((s) => s.id === section.id)).toBe(!hidden.has(section.id));
    }
  });
});

describe('settings catalogue invariants', () => {
  it('places Development beside Performance and About in the App group', () => {
    expect(SETTINGS_SECTIONS.filter(section => section.group === 'app').map(section => section.id))
      .toEqual(['performance', 'development', 'about']);
    expect(SETTINGS_SECTIONS.find(section => section.id === 'development')?.projectScoped).toBeUndefined();
    expect(SETTINGS_SUBSECTIONS.development).toEqual([{ id: 'bundled-plugins', label: 'Bundled plugins' }]);
  });

  it('declares a Peers section exactly once', () => {
    const peers = SETTINGS_SECTIONS.filter((s) => s.id === 'peers');
    expect(peers).toHaveLength(1);
  });

  it('has unique section ids', () => {
    const ids = SETTINGS_SECTIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('assigns every section to a declared group', () => {
    const groupIds = new Set(SETTINGS_GROUPS.map((g) => g.id));
    for (const section of SETTINGS_SECTIONS) {
      expect(groupIds.has(section.group)).toBe(true);
    }
  });
});


it('keeps phone access inside Remote access rather than a duplicate Mobile destination', () => {
  expect(SETTINGS_SECTIONS.some(section => section.id === 'phone')).toBe(false);
  expect(SETTINGS_SECTIONS.find(section => section.id === 'machines')?.desc).toContain('run projects and agents');
});
