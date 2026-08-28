import { describe, expect, it } from 'vitest';
import {
  TIMELINE_INLINE_OUTPUT_PREVIEW_THRESHOLD_CHARS,
  previewTimelineResponseOutputs
} from './timeline-output-preview.js';
import type { TimelineRow } from '@zana-ai/zcc-server-contract';

function commandRow(output: string): TimelineRow {
  return {
    id: 'c1',
    threadId: 't1',
    turnId: 'turn-1',
    sourceSeqStart: 1,
    sourceSeqEnd: 1,
    startedAt: 1,
    createdAt: 1,
    kind: 'work',
    workKind: 'command',
    status: 'completed',
    callId: 'c1',
    command: 'echo',
    cwd: null,
    source: null,
    output,
    exitCode: 0,
    completedAt: 2,
    approvalStatus: null,
    activityIntents: []
  };
}

describe('timeline output preview', () => {
  it('leaves small command output inline', () => {
    const row = commandRow('hello');
    const previewed = previewTimelineResponseOutputs({ rows: [row] });
    expect(previewed.rows[0]).toBe(row);
  });

  it('replaces large command output with a head/tail preview', () => {
    const output = 'x'.repeat(TIMELINE_INLINE_OUTPUT_PREVIEW_THRESHOLD_CHARS + 1);
    const previewed = previewTimelineResponseOutputs({ rows: [commandRow(output)] });
    const row = previewed.rows[0];
    expect(row.kind).toBe('work');
    if (row.kind !== 'work' || row.workKind !== 'command') throw new Error('expected command');
    expect(row.outputPreview?.totalChars).toBe(output.length);
    expect(row.output.length).toBeLessThan(output.length);
    expect(row.output).toContain('characters omitted from preview');
  });
});
