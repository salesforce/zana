import { Component, useMemo, useSyncExternalStore, type ReactElement, type ReactNode } from 'react';
import type { JsonValue } from '@zana-ai/zcc-domain/thread-runtime';
import type { PluginTimelineRendererProps, PluginTimelineRendererRegistration } from '@zana-ai/zcc-plugin-sdk';
import type { TimelineViewWorkRow } from '@zana-ai/zcc-thread-view';
import { listTimelineRenderers, subscribePluginSlots } from '../../../plugins/plugin-slots.js';

export type PluginRenderableWorkRow = Extract<TimelineViewWorkRow, { workKind: 'extension' | 'tool' }>;

export function isPluginRenderableWorkRow(
  row: TimelineViewWorkRow
): row is PluginRenderableWorkRow {
  return row.workKind === 'extension' || row.workKind === 'tool';
}

function resolveTimelineRenderer(
  slots: readonly PluginTimelineRendererRegistration[],
  row: PluginRenderableWorkRow
): PluginTimelineRendererRegistration | null {
  if (row.workKind === 'extension') {
    return slots.find((slot) => slot.kind === row.extensionKind) ?? null;
  }
  return slots.find((slot) => slot.kind === 'tool' && slot.pluginId) ?? null;
}

class PluginRowErrorBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  render(): ReactNode {
    if (this.state.failed) return this.props.fallback;
    return this.props.children;
  }
}

function rendererPayload(row: PluginRenderableWorkRow): JsonValue {
  if (row.workKind === 'extension') return row.payload;
  return { arguments: row.toolArgs, output: row.output };
}

export function PluginTimelineRendererBody({
  row,
  original
}: {
  row: PluginRenderableWorkRow;
  original: () => ReactElement | null;
}) {
  const slots = useSyncExternalStore(subscribePluginSlots, listTimelineRenderers, listTimelineRenderers);
  const slot = useMemo(() => resolveTimelineRenderer(slots, row), [row, slots]);
  const originalBody = original();
  if (!slot) return originalBody;
  const Original = () => originalBody;
  const props: PluginTimelineRendererProps = {
    row: {
      id: row.id,
      threadId: row.threadId,
      turnId: row.turnId,
      kind: row.workKind === 'extension' ? row.extensionKind : 'tool',
      toolName: row.workKind === 'tool' ? row.toolName : null,
      status: row.status,
      startedAt: row.startedAt,
      completedAt: row.completedAt
    },
    payload: rendererPayload(row),
    presentation: row.presentation
      ? {
        label: row.presentation.label,
        title: row.presentation.title,
        detail: row.presentation.detail
      }
      : null,
    thread: { id: row.threadId, providerId: null },
    Original
  };
  return (
    <PluginRowErrorBoundary fallback={originalBody}>
      <slot.component {...props} />
    </PluginRowErrorBoundary>
  );
}
