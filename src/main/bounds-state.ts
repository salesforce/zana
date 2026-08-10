import type { AppConfig } from '../shared/types.js';

export type WindowBounds = Required<NonNullable<AppConfig['windowBounds']>>;

export type DisplayWorkArea = {
  id: number;
  workArea: WindowBounds;
};

export type RestoredWindowState = {
  bounds: WindowBounds;
  minWidth: number;
  minHeight: number;
  maximized: boolean;
};

const DEFAULT_BOUNDS: WindowBounds = { width: 1400, height: 900, x: 0, y: 0 };
const MIN_WIDTH = 900;
const MIN_HEIGHT = 600;

function overlap(a: WindowBounds, b: WindowBounds): number {
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return width * height;
}

function contains(area: WindowBounds, bounds: WindowBounds): boolean {
  return (
    bounds.x >= area.x &&
    bounds.y >= area.y &&
    bounds.x + bounds.width <= area.x + area.width &&
    bounds.y + bounds.height <= area.y + area.height
  );
}

function normalDisplay(
  bounds: WindowBounds | undefined,
  displays: DisplayWorkArea[],
  primary: DisplayWorkArea
): DisplayWorkArea {
  if (!bounds) return primary;
  return displays.reduce(
    (best, display) => (overlap(bounds, display.workArea) > overlap(bounds, best.workArea) ? display : best),
    primary
  );
}

/** Select a visible display, then fit saved dimensions and position to its work area. */
export function restoreWindowState(
  saved: AppConfig['windowBounds'] | undefined,
  maximized: boolean | undefined,
  displays: DisplayWorkArea[],
  primary: DisplayWorkArea
): RestoredWindowState {
  const normalized = saved && saved.x !== undefined && saved.y !== undefined
    ? { x: saved.x, y: saved.y, width: saved.width, height: saved.height }
    : undefined;
  const display = normalDisplay(normalized, displays, primary);
  const area = display.workArea;
  const width = Math.min(normalized?.width ?? DEFAULT_BOUNDS.width, area.width);
  const height = Math.min(normalized?.height ?? DEFAULT_BOUNDS.height, area.height);
  const candidate: WindowBounds = {
    x: normalized?.x ?? area.x,
    y: normalized?.y ?? area.y,
    width,
    height
  };
  const bounds = contains(area, candidate)
    ? candidate
    : { x: area.x, y: area.y, width, height };
  return {
    bounds,
    // Electron must not force dimensions larger than a small display's work area.
    minWidth: Math.min(MIN_WIDTH, area.width),
    minHeight: Math.min(MIN_HEIGHT, area.height),
    maximized: maximized === true
  };
}

export type BoundsWindow = {
  isDestroyed(): boolean;
  isMinimized(): boolean;
  isMaximized(): boolean;
  isNormal(): boolean;
  isFullScreen(): boolean;
  unmaximize(): void;
  setBounds(bounds: WindowBounds): void;
  getNormalBounds(): WindowBounds;
};

export type BoundsStateController = {
  scheduleBounds(): void;
  beginFullscreenTransition(): void;
  endFullscreenTransition(): void;
  setMaximized(maximized: boolean): void;
  flushForClose(): void;
  flush(): void;
};

export function createBoundsStateController(options: {
  win: BoundsWindow;
  initialBounds?: AppConfig['windowBounds'];
  initialMaximized?: boolean;
  write: (state: Pick<AppConfig, 'windowBounds' | 'windowMaximized'>) => void;
  delayMs?: number;
}): BoundsStateController {
  let timer: NodeJS.Timeout | null = null;
  let bounds = options.initialBounds;
  let pendingBounds: AppConfig['windowBounds'] | undefined;
  let boundsDirty = false;
  let maximizedDirty = false;
  let fullscreenTransition = false;
  let maximized = options.initialMaximized === true || options.win.isMaximized();

  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (options.win.isDestroyed() || (!boundsDirty && !maximizedDirty)) return;
    if (pendingBounds) {
      bounds = pendingBounds;
      pendingBounds = undefined;
    }
    options.write({ windowBounds: bounds, windowMaximized: maximized });
    boundsDirty = false;
    maximizedDirty = false;
  };

  const scheduleBounds = () => {
    if (
      options.win.isDestroyed() ||
      fullscreenTransition ||
      options.win.isMinimized() ||
      maximized ||
      options.win.isMaximized() ||
      options.win.isFullScreen()
    ) return;
    pendingBounds = options.win.getNormalBounds();
    boundsDirty = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, options.delayMs ?? 400);
  };

  return {
    scheduleBounds,
    beginFullscreenTransition() {
      if (!options.win.isDestroyed()) {
        bounds = options.win.getNormalBounds();
        pendingBounds = undefined;
        boundsDirty = true;
      }
      // Native fullscreen is deliberately transient. Relaunch as a normal window.
      maximized = false;
      maximizedDirty = true;
      fullscreenTransition = true;
      flush();
    },
    endFullscreenTransition() {
      fullscreenTransition = false;
    },
    setMaximized(value) {
      maximized = value;
      maximizedDirty = true;
      if (value) {
        if (timer) clearTimeout(timer);
        timer = null;
        pendingBounds = undefined;
      }
      flush();
    },
    flushForClose() {
      if (!options.win.isDestroyed() && options.win.isFullScreen()) {
        maximized = false;
        maximizedDirty = true;
      } else if (!options.win.isDestroyed() && options.win.isMaximized()) {
        maximized = true;
        maximizedDirty = true;
      }
      flush();
    },
    flush
  };
}
