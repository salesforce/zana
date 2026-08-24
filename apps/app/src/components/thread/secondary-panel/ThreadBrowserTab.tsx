import { useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, RotateCw } from 'lucide-react';
import { commitBrowserUrl, invokeWebviewMethod } from './threadSecondaryPanelLogic.js';

export function ThreadBrowserTab({
  initialUrl = 'https://example.com',
  onUrlChange
}: {
  initialUrl?: string;
  onUrlChange?: (url: string) => void;
}) {
  const [draft, setDraft] = useState(initialUrl);
  const [src, setSrc] = useState(initialUrl);
  const viewRef = useRef<HTMLElement | null>(null);

  const commit = (next: string) => {
    commitBrowserUrl(next, (url) => {
      setDraft(url);
      setSrc(url);
      onUrlChange?.(url);
    });
  };

  return (
    <div className="thread-browser-tab" data-testid="thread-browser-tab">
      <div className="thread-browser-chrome">
        <button type="button" aria-label="Back" onClick={() => invokeWebviewMethod(viewRef.current as { goBack?: () => void } | null, 'goBack')}>
          <ArrowLeft size={14} />
        </button>
        <button type="button" aria-label="Forward" onClick={() => invokeWebviewMethod(viewRef.current as { goForward?: () => void } | null, 'goForward')}>
          <ArrowRight size={14} />
        </button>
        <button type="button" aria-label="Reload" onClick={() => invokeWebviewMethod(viewRef.current as { reload?: () => void } | null, 'reload')}>
          <RotateCw size={14} />
        </button>
        <input
          value={draft}
          aria-label="Browser URL"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit(draft);
          }}
        />
      </div>
      <webview
        ref={(node: HTMLElement | null) => { viewRef.current = node; }}
        className="thread-browser-view"
        src={src}
      />
    </div>
  );
}
