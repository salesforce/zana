import type { ComponentType, CSSProperties } from 'react';
import {
  Briefcase,
  Circle,
  Cloud,
  Code,
  Database,
  Folder,
  Globe,
  Layers,
  Package,
  Rocket,
  Terminal,
  Wrench
} from 'lucide-react';
import './project-marker.css';

type GlyphProps = { size?: number; strokeWidth?: number };

// Static map (no dynamic icon imports) so bundlers can tree-shake.
const GLYPHS: Record<string, ComponentType<GlyphProps>> = {
  Circle,
  Cloud,
  Folder,
  Code,
  Database,
  Globe,
  Package,
  Rocket,
  Briefcase,
  Terminal,
  Layers,
  Wrench
};

export const PROJECT_MARKER_ICONS: readonly string[] = Object.keys(GLYPHS);

export interface ProjectMarkerProps {
  icon?: string;
  color?: string;
  /** Glyph size in px (default 12). A plain dot stays 8px unless set. */
  size?: number;
  unread?: boolean;
  title?: string;
  /** Extra classes appended to the root (host styling hooks). */
  className?: string;
}

/** Single project marker: filled dot (Circle/unknown/absent icon) or a glyph. */
export function ProjectMarker({ icon, color, size, unread = false, title, className }: ProjectMarkerProps) {
  const known = typeof icon === 'string' && Object.hasOwn(GLYPHS, icon);
  const Glyph = known && icon !== 'Circle' ? GLYPHS[icon as string] : undefined;
  const classes = (kind: string) =>
    ['project-marker', kind, color ? '' : 'project-marker--neutral', unread ? 'unread' : '', className ?? '']
      .filter(Boolean)
      .join(' ');

  if (!Glyph) {
    const style: CSSProperties = {};
    if (color) style.background = color;
    if (size) {
      style.width = size;
      style.height = size;
    }
    return (
      <span
        className={classes('project-marker--dot')}
        style={Object.keys(style).length ? style : undefined}
        title={title}
        aria-hidden
      />
    );
  }
  const style: CSSProperties = {};
  if (color) style.color = color;
  if (size) {
    style.width = size;
    style.height = size;
  }
  return (
    <span
      className={classes('project-marker--icon')}
      data-project-icon={icon}
      style={Object.keys(style).length ? style : undefined}
      title={title}
      aria-hidden
    >
      <Glyph size={size ?? 12} strokeWidth={2.25} />
    </span>
  );
}
