import { Fragment } from 'react';
import type { TimelineTitle, TimelineTitleAction, TimelineTitleLink } from '@zana-ai/zcc-thread-view';
import { decorationClass, decorationText, titleSegmentClass } from './timeline-title.js';

export type TimelineTitleActionHandler = (action: TimelineTitleAction) => void;
export type TimelineTitleLinkHandler = (link: TimelineTitleLink) => void;

export function stopTitleEvent(event: { preventDefault(): void; stopPropagation(): void }): void {
  event.preventDefault();
  event.stopPropagation();
}

export function TimelineTitleView({
  title,
  now,
  onAction,
  onLink
}: {
  title: TimelineTitle;
  now: number;
  onAction?: TimelineTitleActionHandler;
  onLink?: TimelineTitleLinkHandler;
}) {
  return (
    <span className="thread-timeline-title">
      {title.segments.map((segment, index) => {
        const className = titleSegmentClass(segment);
        if (segment.link && onLink) {
          return (
            <button
              key={`${segment.text}-${index}`}
              type="button"
              className={`thread-timeline-title-link ${className}`.trim()}
              onClick={(event) => {
                stopTitleEvent(event);
                onLink(segment.link!);
              }}
            >
              {segment.text}
            </button>
          );
        }
        if (title.action && onAction && (segment.accent === 'file' || title.action.kind === 'open-file-diff')) {
          return (
            <button
              key={`${segment.text}-${index}`}
              type="button"
              className={`thread-timeline-title-action ${className}`.trim()}
              onClick={(event) => {
                stopTitleEvent(event);
                onAction(title.action!);
              }}
            >
              {segment.text}
            </button>
          );
        }
        return (
          <span key={`${segment.text}-${index}`} className={className}>
            {segment.text}
          </span>
        );
      })}
      {title.decorations.map((decoration, index) => {
        const text = decorationText(decoration, now);
        if (!text) return <Fragment key={`${decoration.kind}-${index}`} />;
        return (
          <span key={`${decoration.kind}-${index}`} className={decorationClass(decoration)}>
            {text}
          </span>
        );
      })}
    </span>
  );
}
