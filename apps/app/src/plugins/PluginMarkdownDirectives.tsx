import { Fragment, useMemo, useSyncExternalStore, type ComponentType } from 'react';
import { MarkdownContent } from '../components/MarkdownContent.js';
import { parseReviewComments, type ReviewComment as ParsedReviewComment } from '../components/markdown-review-comments.js';
import { ReviewComment } from '../components/thread/timeline/ReviewComment.js';
import { useIncrementalMarkdownPieces } from '../components/markdown-incremental-pieces.js';
import { collectMarkdownLightboxItems } from '../components/thread/timeline/thread-inline-images.js';
import { openWorkspaceFileForThread } from '../components/thread/secondary-panel/useThreadOpenFileSignal.js';
import { PluginSlotBoundary } from './PluginSlotBoundary.js';
import { listMessageDirectives, subscribePluginSlots } from './plugin-slots.js';
import {
  parseMessageDirectives,
  type ParsedMessageDirective
} from './plugin-slot-resolvers.js';

export function PluginMarkdownDirectives({
  text,
  threadId,
  projectId,
  messageId,
  threadMentions = false,
  openWorkspaceFile,
  filePathHints
}: {
  text: string;
  threadId?: string;
  projectId?: string | null;
  messageId: string;
  threadMentions?: boolean;
  openWorkspaceFile?: ((path: string) => boolean) | null;
  filePathHints?: readonly string[];
}) {
  const registrations = useSyncExternalStore(
    subscribePluginSlots,
    listMessageDirectives,
    listMessageDirectives
  );
  const parsed = parseMessageDirectives(text);
  const comments = parseReviewComments(text);
  const byName = new Map(registrations.map((row) => [row.id, row]));
  const hasRegisteredDirective = parsed.some((dir) => byName.has(dir.name));
  const pieces = useIncrementalMarkdownPieces(text, !hasRegisteredDirective && comments.length === 0);
  const documentLightboxItems = useMemo(
    () => collectMarkdownLightboxItems(text, projectId),
    [projectId, text]
  );
  const markdownProps = {
    threadId,
    projectId,
    threadMentions,
    filePathHints,
    lightboxItems: documentLightboxItems
  };
  if (!hasRegisteredDirective && comments.length === 0) {
    let offset = 0;
    return (
      <>
        {pieces.map((piece) => {
          const key = offset;
          offset += piece.length;
          return piece.trim() ? (
            <MarkdownContent
              key={key}
              text={piece}
              {...markdownProps}
            />
          ) : (
            <Fragment key={key} />
          );
        })}
      </>
    );
  }
  type SpecialSegment = { kind: 'dir'; dir: ParsedMessageDirective } | { kind: 'comment'; dir: ParsedReviewComment };
  const special: SpecialSegment[] = [
    ...comments.map((dir): SpecialSegment => ({ kind: 'comment', dir })),
    ...parsed.filter((dir) => byName.has(dir.name) && !comments.some((comment) => dir.start >= comment.start && dir.start < comment.end))
      .map((dir): SpecialSegment => ({ kind: 'dir', dir }))
  ].sort((a, b) => a.dir.start - b.dir.start);
  const segments: Array<{ kind: 'md'; text: string } | SpecialSegment> = [];
  let cursor = 0;
  for (const segment of special) {
    const { dir } = segment;
    if (dir.start > cursor) segments.push({ kind: 'md', text: text.slice(cursor, dir.start) });
    segments.push(segment);
    cursor = dir.end;
  }
  if (cursor < text.length) segments.push({ kind: 'md', text: text.slice(cursor) });
  if (segments.every((segment) => segment.kind === 'md')) {
    return (
      <MarkdownContent
        text={text}
        {...markdownProps}
      />
    );
  }
  return (
    <>
      {segments.map((segment, index) => {
        if (segment.kind === 'md') {
          return segment.text.trim() ? (
            <MarkdownContent
              key={`md-${index}`}
              text={segment.text}
              {...markdownProps}
            />
          ) : (
            <Fragment key={`md-${index}`} />
          );
        }
        if (segment.kind === 'comment') {
          return <ReviewComment key={`comment-${segment.dir.start}`} comment={segment.dir} threadId={threadId} projectId={projectId} filePathHints={filePathHints} />;
        }
        const registration = byName.get(segment.dir.name);
        if (!registration) return <code key={`dir-${index}`}>{segment.dir.source}</code>;
        const Component = registration.component as ComponentType<{
          pluginId: string;
          attributes: Readonly<Record<string, string>>;
          source: string;
          message: {
            id: string;
            threadId: string;
            turnId: string | null;
            projectId: string | null;
          };
          openWorkspaceFile: ((path: string) => boolean) | null;
        }>;
        const opener = openWorkspaceFile === undefined
          ? (threadId
            ? (path: string) => openWorkspaceFileForThread(threadId, path)
            : null)
          : openWorkspaceFile;
        return (
          <PluginSlotBoundary
            key={`dir-${index}:${registration.generation}`}
            pluginId={registration.pluginId}
            generation={registration.generation}
          >
            <Component
              pluginId={registration.pluginId}
              attributes={segment.dir.attributes}
              source={segment.dir.source}
              message={{
                id: messageId,
                threadId: threadId ?? '',
                turnId: null,
                projectId: projectId ?? null
              }}
              openWorkspaceFile={opener}
            />
          </PluginSlotBoundary>
        );
      })}
    </>
  );
}
