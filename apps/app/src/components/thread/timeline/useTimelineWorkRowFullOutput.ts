import { useCallback, useEffect, useState } from 'react';
import type { TimelineCommandWorkRow, TimelineToolWorkRow } from '@zana-ai/zcc-server-contract';
import { product } from '../../../lib/product-client.js';

export type TimelinePreviewableWorkRow = TimelineCommandWorkRow | TimelineToolWorkRow;

export type TimelineWorkRowFullOutputState =
  | 'complete'
  | 'streaming-preview'
  | 'loading'
  | 'error'
  | 'loaded';

export interface TimelineWorkRowFullOutput {
  output: string;
  state: TimelineWorkRowFullOutputState;
  retry: () => void;
}

export function useTimelineWorkRowFullOutput(
  row: TimelinePreviewableWorkRow
): TimelineWorkRowFullOutput {
  const isPreview = row.outputPreview !== undefined;
  const shouldLoad = isPreview && row.turnId !== null && row.status !== 'pending';
  const [loaded, setLoaded] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!shouldLoad) return;
    let cancelled = false;
    setFailed(false);
    void product.threads.timelineTurnSummaryDetails(row.threadId, {
      turnId: row.turnId ?? '',
      sourceSeqStart: String(row.sourceSeqStart),
      sourceSeqEnd: String(row.sourceSeqEnd)
    }).then((body) => {
      if (cancelled) return;
      const rows = Array.isArray((body as { rows?: unknown }).rows)
        ? (body as { rows: Array<{ id?: string; kind?: string; workKind?: string; callId?: string; output?: string }> }).rows
        : [];
      const match = rows.find((candidate) => candidate.id === row.id)
        ?? rows.find((candidate) => (
          candidate.kind === 'work'
          && candidate.workKind === row.workKind
          && candidate.callId === row.callId
        ));
      if (match && typeof match.output === 'string') {
        setLoaded(match.output);
        return;
      }
      setFailed(true);
    }).catch(() => {
      if (!cancelled) setFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [nonce, row.callId, row.id, row.sourceSeqEnd, row.sourceSeqStart, row.threadId, row.turnId, row.workKind, shouldLoad]);

  const retry = useCallback(() => {
    setNonce((value) => value + 1);
  }, []);

  if (!isPreview) {
    return { output: row.output, state: 'complete', retry };
  }
  if (loaded !== null) {
    return { output: loaded, state: 'loaded', retry };
  }
  if (!shouldLoad) {
    return { output: row.output, state: 'streaming-preview', retry };
  }
  if (failed) {
    return { output: row.output, state: 'error', retry };
  }
  return { output: row.output, state: 'loading', retry };
}
