import type { ReactNode } from 'react';
import { Columns2, Flag } from 'lucide-react';
import type { ComposerWorkMode } from './composer-mode.js';

export function ComposerModeIcon({ mode }: { mode: ComposerWorkMode }): ReactNode {
  if (mode === 'agent') {
    return <span className="composer-mode-picker-infinity" aria-hidden="true">∞</span>;
  }
  if (mode === 'plan') {
    return <Columns2 size={14} aria-hidden="true" />;
  }
  return <Flag size={14} aria-hidden="true" />;
}
