import { BrowserTabContent } from './BrowserTabContent.js';

export function ThreadBrowserTab({
  tabId = 'browser:preview',
  threadId = 'preview',
  initialUrl = '',
  canShowNativeBrowserView = true,
  automationTargetId = null,
  onUrlChange,
  onStopAutomation
}: {
  tabId?: string;
  threadId?: string;
  initialUrl?: string;
  canShowNativeBrowserView?: boolean;
  automationTargetId?: string | null;
  onUrlChange?: (url: string) => void;
  onStopAutomation?: (targetId: string) => void;
}) {
  return (
    <BrowserTabContent
      tabId={tabId}
      initialUrl={initialUrl}
      canShowNativeBrowserView={canShowNativeBrowserView}
      visibilityCoordinator={null}
      threadId={threadId}
      automationTargetId={automationTargetId}
      onUpdate={({ url }) => onUrlChange?.(url)}
      onStopAutomation={onStopAutomation}
    />
  );
}
