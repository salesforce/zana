import { type ReactNode } from 'react';
import { usePaneSecondaryPanelModel, type PaneSecondaryPanelRegistry } from './PaneContext.js';

export function SplitWorkspaceSecondaryPanelHost({
  children,
  focusedPaneId,
  registry
}: {
  children: ReactNode;
  focusedPaneId: string;
  registry: PaneSecondaryPanelRegistry;
}) {
  const model = usePaneSecondaryPanelModel(registry, focusedPaneId);
  return (
    <div className="split-workspace-host" data-testid="split-workspace-host">
      <div className="split-workspace-main">{children}</div>
      {model?.isOpen ? model.panel : null}
    </div>
  );
}
