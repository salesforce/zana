// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

async function freshStore() {
  vi.resetModules();
  return (await import('../store.js')).useUi;
}

describe('sidebar mode', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to expanded when nothing is stored', async () => {
    const ui = await freshStore();
    expect(ui.getState().sidebarMode).toBe('expanded');
    expect(ui.getState().sidebarCollapsed).toBe(false);
  });

  it.each([
    ['1', 'hidden', true],
    ['0', 'expanded', false],
    ['garbage', 'expanded', false]
  ] as const)('migrates legacy collapsed=%s to %s', async (legacy, mode, collapsed) => {
    localStorage.setItem('zcc.sidebarCollapsed', legacy);
    const ui = await freshStore();
    expect(ui.getState().sidebarMode).toBe(mode);
    expect(ui.getState().sidebarCollapsed).toBe(collapsed);
  });

  it('prefers the new key over the legacy flag and ignores malformed values', async () => {
    localStorage.setItem('zcc.sidebarMode', 'rail');
    localStorage.setItem('zcc.sidebarCollapsed', '1');
    expect((await freshStore()).getState().sidebarMode).toBe('rail');
    localStorage.setItem('zcc.sidebarMode', 'bogus');
    expect((await freshStore()).getState().sidebarMode).toBe('hidden');
  });

  it('mirrors the legacy key and keeps sidebarCollapsed equal to hidden', async () => {
    const ui = await freshStore();
    for (const [mode, legacy] of [['rail', '0'], ['hidden', '1'], ['expanded', '0']] as const) {
      ui.getState().setSidebarMode(mode);
      expect(localStorage.getItem('zcc.sidebarMode')).toBe(mode);
      expect(localStorage.getItem('zcc.sidebarCollapsed')).toBe(legacy);
      expect(ui.getState().sidebarCollapsed).toBe(mode === 'hidden');
    }
  });

  it('cycleSidebarMode goes expanded -> rail -> hidden -> expanded', async () => {
    const ui = await freshStore();
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      ui.getState().cycleSidebarMode();
      seen.push(ui.getState().sidebarMode);
    }
    expect(seen).toEqual(['rail', 'hidden', 'expanded', 'rail']);
  });

  it('toggleSidebar keeps expanded <-> hidden semantics and restores the last visible mode', async () => {
    const ui = await freshStore();
    ui.getState().setSidebarMode('rail');
    ui.getState().toggleSidebar();
    expect(ui.getState().sidebarMode).toBe('hidden');
    ui.getState().toggleSidebar();
    expect(ui.getState().sidebarMode).toBe('rail');
  });

  it('survives unavailable storage', async () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const setSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const ui = await freshStore();
    expect(ui.getState().sidebarMode).toBe('expanded');
    expect(() => ui.getState().setSidebarMode('rail')).not.toThrow();
    expect(ui.getState().sidebarMode).toBe('rail');
    spy.mockRestore();
    setSpy.mockRestore();
  });
});
