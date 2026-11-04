import { useState } from 'react';
import { resolveIcon } from '../../lib/resolveIcon.js';
import { displayIcon } from './installed-plugins.js';
import './plugin-brand-icon.css';

/** Render declared branding as an inert image, preserving SVG colors. */
export function PluginBrandIcon({ src, icon, size = 20 }: {
  src?: string | null;
  icon?: string;
  size?: number;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const Icon = resolveIcon(displayIcon(icon ?? 'Puzzle'));
  if (!src || failed === src) return <Icon size={size} />;
  return <img className="plugin-brand-icon" src={src} alt="" width={size} height={size}
    referrerPolicy="no-referrer" onError={() => setFailed(src)} />;
}
