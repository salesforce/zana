/** Persisted project glyphs shared by the host, plugin SDK, and icon picker. */
export const PROJECT_ICONS = [
  'Circle', 'Cloud', 'Folder', 'Code', 'Database', 'Globe',
  'Package', 'Rocket', 'Briefcase', 'Terminal', 'Layers', 'Wrench',
] as const;

export type ProjectIcon = (typeof PROJECT_ICONS)[number];

export function isProjectIcon(value: unknown): value is ProjectIcon {
  return typeof value === 'string' && (PROJECT_ICONS as readonly string[]).includes(value);
}
