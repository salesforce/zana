import type { ReactNode } from 'react';
import { ThreadDetailActions, ThreadDetailHeading } from './thread/timeline/ThreadBanners.js';
import { useMobileThreadControlsTarget, useMobileThreadTitleTarget } from './useMobileThreadTitleTarget.js';

/** Routed CLI agents share the phone's single-row header with threads. */
export function AgentSessionHeader({ title, useShellTitle, children }: {
  title: string;
  useShellTitle: boolean;
  children: ReactNode;
}) {
  const target = useMobileThreadTitleTarget(useShellTitle);
  const controls = useMobileThreadControlsTarget(useShellTitle);
  return <header className="thread-detail-header" data-title-in-shell={Boolean(target) || undefined} data-controls-in-shell={Boolean(controls) || undefined}>
    <ThreadDetailHeading title={title} titleTarget={target} />
    <ThreadDetailActions target={controls}>{children}</ThreadDetailActions>
  </header>;
}
