import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture the native context-menu template TrayController hands to Menu.
const menus: Electron.MenuItemConstructorOptions[][] = [];
vi.mock('electron', () => ({
  Tray: class {
    setToolTip() {}
    setTitle() {}
    setImage() {}
    setContextMenu() {}
    isDestroyed() {
      return false;
    }
    on() {}
    destroy() {}
  },
  Menu: {
    buildFromTemplate: (items: Electron.MenuItemConstructorOptions[]) => {
      menus.push(items);
      return {};
    }
  },
  nativeImage: { createFromPath: () => ({ isEmpty: () => true, resize: () => ({}) }) },
  nativeTheme: { shouldUseDarkColors: false, on: vi.fn(), off: vi.fn() }
}));
vi.mock('./tray-icon.js', () => ({
  buildAppGlyphTemplateImage: () => ({}),
  buildAppGlyphAttentionImage: () => ({})
}));

import { TrayController, type TrayDeps } from './tray.js';

const LABEL = 'Minimize to Command Center';

function makeController(commandCenter?: TrayDeps['commandCenter']) {
  const emitter = () => ({ on: vi.fn(), off: vi.fn() });
  const deps = {
    scheduler: { ...emitter(), list: () => [] },
    ptys: { ...emitter(), list: () => [], listAll: () => [] },
    agentStatus: { ...emitter(), get: () => 'idle' },
    projectName: () => 'p',
    showWindow: vi.fn(),
    focusSession: vi.fn(),
    openScheduler: vi.fn(),
    popoverEnabled: () => false,
    commandCenter,
    iconPath: null
  } as unknown as TrayDeps;
  const ctl = new TrayController(deps);
  ctl.start();
  return ctl;
}

describe('TrayController "Minimize to Command Center" item', () => {
  beforeEach(() => {
    menus.length = 0;
    vi.useFakeTimers();
  });

  it('is present and calls enter() on click when enabled', () => {
    const enter = vi.fn();
    const ctl = makeController({ enabled: () => true, enter });
    const item = menus.at(-1)!.find((i) => i.label === LABEL);
    expect(item).toBeDefined();
    (item!.click as () => void)();
    expect(enter).toHaveBeenCalledTimes(1);
    ctl.stop();
  });

  it('is absent when enabled() is false', () => {
    const ctl = makeController({ enabled: () => false, enter: vi.fn() });
    expect(menus.at(-1)!.some((i) => i.label === LABEL)).toBe(false);
    ctl.stop();
  });

  it('is absent when commandCenter is not provided', () => {
    const ctl = makeController(undefined);
    expect(menus.at(-1)!.some((i) => i.label === LABEL)).toBe(false);
    ctl.stop();
  });
});
