import { Globe } from 'lucide-react';
import { getBrowserUrlHost } from '../../../lib/browser-url.js';
import type { BrowserHistoryEntry } from '../../../lib/browser-history.js';
import { formatRecentRelativeTime } from './threadRecentItems.js';

export function BrowserNewTabScreen({
  onNavigateInput,
  recent,
  onClearRecent
}: {
  onNavigateInput: (rawInput: string) => void;
  recent: readonly BrowserHistoryEntry[];
  onClearRecent: () => void;
}) {
  const now = Date.now();
  return (
    <div className="thread-browser-newtab" data-testid="thread-browser-newtab">
      <div className="thread-browser-newtab-header">
        <h3>Recently visited</h3>
        {recent.length > 0 ? (
          <button type="button" onClick={onClearRecent} aria-label="Clear recently visited">
            Clear
          </button>
        ) : null}
      </div>
      {recent.length === 0 ? (
        <p className="thread-browser-newtab-empty">Pages you open here will show up in this list.</p>
      ) : (
        <ul aria-label="Recently visited">
          {recent.map((entry) => {
            const host = getBrowserUrlHost(entry.url);
            const title = entry.title?.trim();
            const primary = title && title.length > 0 ? title : host;
            return (
              <li key={entry.url}>
                <button type="button" title={entry.url} onClick={() => onNavigateInput(entry.url)}>
                  <Globe size={14} aria-hidden />
                  <span className="thread-info-truncate">{primary}</span>
                  {primary !== host ? <span className="thread-browser-recent-host">{host}</span> : null}
                  <span className="thread-browser-recent-time">{formatRecentRelativeTime(entry.visitedAt, now)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
