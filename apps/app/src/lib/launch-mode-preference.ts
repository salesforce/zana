export const LAUNCH_MODES = ['agent', 'thread', 'team'] as const;
export type LaunchMode = (typeof LAUNCH_MODES)[number];

export const DEFAULT_LAUNCH_MODE: LaunchMode = 'thread';
export const LAUNCH_MODE_PREF_KEY = 'zcc.defaultLaunchMode';

const PREFS_EVENT = 'zcc-prefs';

export const LAUNCH_MODE_LABELS: Record<LaunchMode, string> = {
  thread: 'Modern',
  agent: 'CLI Agent',
  team: 'Team'
};

export const LAUNCH_MODE_PICKLIST_OPTIONS = LAUNCH_MODES.map((value) => ({
  value,
  label: LAUNCH_MODE_LABELS[value]
}));

/** Which New Chat / New agent surfaces Settings currently offers. */
export interface ComposerSurfaceFlags {
  showCliAgent: boolean;
  showModern: boolean;
  showTeam: boolean;
}

export const COMPOSER_SURFACE_DEFAULTS: ComposerSurfaceFlags = {
  showCliAgent: true,
  showModern: true,
  showTeam: true
};

export function composerSurfacesFromConfig(config: {
  composerShowCliAgent?: boolean;
  composerShowModern?: boolean;
  composerShowAutonomousTeam?: boolean;
  teamJobLaunchEnabled?: boolean;
}): ComposerSurfaceFlags {
  return {
    showCliAgent: config.composerShowCliAgent !== false,
    showModern: config.composerShowModern !== false,
    showTeam: config.composerShowAutonomousTeam !== false || config.teamJobLaunchEnabled !== false
  };
}

/** Never persist a pair that hides both Modern and CLI Agent. */
export function normalizeComposerSurfaces(flags: ComposerSurfaceFlags): ComposerSurfaceFlags {
  if (!flags.showCliAgent && !flags.showModern) {
    return { ...flags, showCliAgent: true };
  }
  return flags;
}

export function canDisableComposerSurface(
  mode: 'agent' | 'thread',
  flags: ComposerSurfaceFlags
): boolean {
  return mode === 'agent' ? flags.showModern : flags.showCliAgent;
}

export function composerSurfacesToConfigPatch(flags: ComposerSurfaceFlags): {
  composerShowCliAgent: boolean;
  composerShowModern: boolean;
  composerShowAutonomousTeam: boolean;
  teamJobLaunchEnabled: boolean;
} {
  const next = normalizeComposerSurfaces(flags);
  return {
    composerShowCliAgent: next.showCliAgent,
    composerShowModern: next.showModern,
    composerShowAutonomousTeam: next.showTeam,
    teamJobLaunchEnabled: next.showTeam
  };
}

export function visibleComposerLaunchModes(
  flags: ComposerSurfaceFlags,
  runtime: { hasTeams: boolean }
): ComposerSurfaceFlags {
  const next = normalizeComposerSurfaces(flags);
  return {
    showCliAgent: next.showCliAgent,
    showModern: next.showModern,
    showTeam: next.showTeam && runtime.hasTeams
  };
}

export function visibleLaunchModeCount(available: ComposerSurfaceFlags): number {
  return (
    Number(available.showCliAgent)
    + Number(available.showModern)
    + Number(available.showTeam)
  );
}

export function launchModePicklistOptions(flags: ComposerSurfaceFlags): Array<{
  value: LaunchMode;
  label: string;
}> {
  const shown = normalizeComposerSurfaces(flags);
  return LAUNCH_MODES.filter((value) => {
    if (value === 'agent') return shown.showCliAgent;
    if (value === 'thread') return shown.showModern;
    return shown.showTeam;
  }).map((value) => ({ value, label: LAUNCH_MODE_LABELS[value] }));
}

function isSurfaceOffered(mode: LaunchMode, available: ComposerSurfaceFlags): boolean {
  if (mode === 'agent') return available.showCliAgent;
  if (mode === 'thread') return available.showModern;
  return available.showTeam;
}

export function parseLaunchMode(raw: string | null | undefined): LaunchMode {
  if (raw === 'autonomous' || raw === 'job') return 'team';
  if (raw === 'thread' || raw === 'agent' || raw === 'team') {
    return raw;
  }
  return DEFAULT_LAUNCH_MODE;
}

export function readLaunchModePreference(): LaunchMode {
  if (typeof localStorage === 'undefined') return DEFAULT_LAUNCH_MODE;
  try {
    return parseLaunchMode(localStorage.getItem(LAUNCH_MODE_PREF_KEY));
  } catch {
    return DEFAULT_LAUNCH_MODE;
  }
}

export function writeLaunchModePreference(mode: LaunchMode): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(LAUNCH_MODE_PREF_KEY, parseLaunchMode(mode));
  } catch {
    /* quota / private mode */
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(PREFS_EVENT));
  }
}

export function subscribeLaunchModePreference(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = () => onChange();
  window.addEventListener(PREFS_EVENT, handler);
  window.addEventListener('storage', handler);
  return () => {
    window.removeEventListener(PREFS_EVENT, handler);
    window.removeEventListener('storage', handler);
  };
}

export function resolveAvailableLaunchMode(
  mode: LaunchMode,
  available: {
    showCliAgent?: boolean;
    showModern?: boolean;
    showTeam: boolean;
  }
): LaunchMode {
  const surfaces = normalizeComposerSurfaces({
    showCliAgent: available.showCliAgent !== false,
    showModern: available.showModern !== false,
    showTeam: available.showTeam
  });
  if (isSurfaceOffered(mode, surfaces)) return mode;
  for (const candidate of LAUNCH_MODES) {
    if (isSurfaceOffered(candidate, surfaces)) return candidate;
  }
  return 'agent';
}
