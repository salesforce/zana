import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

describe('NativeRolePicker', () => {
  it('uses the shared searchable picklist', () => {
    const source = readFileSync(fileURLToPath(new URL('./NativeRolePicker.tsx', import.meta.url)), 'utf8');
    expect(source).toContain('<PopoverPicklist');
    expect(source).toContain('searchable');
    expect(source).toContain('ariaLabel');
    expect(source).toContain('Refresh roles');
  });

  it('reuses composer-mode trigger chrome and Agent/Plan/Goal icons', () => {
    const source = readFileSync(fileURLToPath(new URL('./NativeRolePicker.tsx', import.meta.url)), 'utf8');
    expect(source).toContain('triggerClassName="composer-mode-picker-trigger"');
    expect(source).toContain('<ComposerModeIcon');
    expect(source).toContain('composerWorkModeForNativeLabel');
    expect(source).toContain('ariaKeyshortcuts="Shift+Tab"');
    expect(source).toContain('(Shift+Tab)');
    expect(source).not.toContain('reasoning-effort-picker-trigger');
    expect(source).not.toContain('SlidersHorizontal');
    expect(source).not.toContain('Users');
  });
});
