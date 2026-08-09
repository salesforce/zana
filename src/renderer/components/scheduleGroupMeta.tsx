import {
  User,
  Briefcase,
  Home,
  Mail,
  MessageSquare,
  Calendar,
  Bell,
  Heart,
  Star,
  Coffee,
  Folder,
  Globe,
  Rocket,
  Bot,
  Bug,
  Wrench,
  type LucideIcon
} from 'lucide-react';

/**
 * Whitelist of lucide icons a schedule group may use. Anything else (a typo in
 * a hand-edited groups.json) falls back to a generic Folder icon, mirroring the
 * template-icon convention in SchedulerPanel. Keep this list curated — it
 * doubles as the icon palette offered in the group editor.
 */
const GROUP_ICONS: Record<string, LucideIcon> = {
  User,
  Briefcase,
  Home,
  Mail,
  MessageSquare,
  Calendar,
  Bell,
  Heart,
  Star,
  Coffee,
  Folder,
  Globe,
  Rocket,
  Bot,
  Bug,
  Wrench
};

/** Ordered icon names for the editor's picker. */
export const GROUP_ICON_NAMES = Object.keys(GROUP_ICONS);

/** Default swatches offered in the group editor. */
export const GROUP_COLORS = [
  '#8b5cf6', // violet
  '#3b82f6', // blue
  '#06b6d4', // cyan
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ef4444', // red
  '#ec4899', // pink
  '#64748b' // slate
];

/** Neutral dot color when a group has no color set. */
export const GROUP_FALLBACK_COLOR = '#64748b';

export function groupIcon(name: string | undefined): LucideIcon {
  return (name && GROUP_ICONS[name]) || Folder;
}
