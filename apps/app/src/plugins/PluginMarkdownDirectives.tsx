import { useSyncExternalStore, type ComponentType } from 'react';
import { MarkdownContent } from '../components/MarkdownContent.js';
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
  messageId
}: {
  text: string;
  threadId?: string;
  projectId?: string | null;
  messageId: string;
}) {
  const registrations = useSyncExternalStore(
    subscribePluginSlots,
    listMessageDirectives,
    listMessageDirectives
  );
  const parsed = parseMessageDirectives(text);
  if (parsed.length === 0 || registrations.length === 0) {
    return <MarkdownContent text={text} />;
  }
  const byName = new Map(registrations.map((row) => [row.id, row]));
  const segments: Array<{ kind: 'md'; text: string } | { kind: 'dir'; dir: ParsedMessageDirective }> = [];
  let cursor = 0;
  for (const dir of parsed) {
    if (!byName.has(dir.name)) continue;
    if (dir.start > cursor) segments.push({ kind: 'md', text: text.slice(cursor, dir.start) });
    segments.push({ kind: 'dir', dir });
    cursor = dir.end;
  }
  if (cursor < text.length) segments.push({ kind: 'md', text: text.slice(cursor) });
  if (segments.every((segment) => segment.kind === 'md')) {
    return <MarkdownContent text={text} />;
  }
  return (
    <>
      {segments.map((segment, index) => {
        if (segment.kind === 'md') {
          return segment.text.trim() ? <MarkdownContent key={`md-${index}`} text={segment.text} /> : null;
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
              openWorkspaceFile={null}
            />
          </PluginSlotBoundary>
        );
      })}
    </>
  );
}
