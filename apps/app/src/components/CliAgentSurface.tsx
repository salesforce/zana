import type { ReactNode } from 'react';
import { useCompactLayout } from '../hooks/useCompactLayout.js';
import { getAppSurface } from '../lib/app-surface.js';
import { PaneEmptyState } from './PaneEmptyState.js';

export function CliAgentSurface({ children }: { children: ReactNode }) {
  const compact = useCompactLayout();
  if (compact || getAppSurface() === 'mobile') {
    return (
      <PaneEmptyState
        testId="cli-agent-mobile-unsupported"
        art="mobile"
        title="CLI Agents aren’t supported on mobile yet"
        hint="Open this agent in the desktop app to view its terminal and continue working."
      />
    );
  }
  return children;
}
