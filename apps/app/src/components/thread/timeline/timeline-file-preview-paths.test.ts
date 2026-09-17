import { describe, expect, it } from 'vitest';
import type { ThreadTimelineViewRow } from '@zana-ai/zcc-thread-view';
import {
  collectTimelineFilePreviewPaths,
  reuseStringListIfEqual
} from './timeline-file-preview-paths.js';

const workBase = {
  threadId: 't1',
  turnId: 'turn-1',
  sourceSeqStart: 1,
  sourceSeqEnd: 1,
  startedAt: 1,
  createdAt: 1,
  kind: 'work' as const,
  callId: 'c1',
  status: 'completed' as const
};

describe('collectTimelineFilePreviewPaths', () => {
  it('walks file-change, rename destination, file-read, and nested rows in order', () => {
    const nestedChange: ThreadTimelineViewRow = {
      ...workBase,
      id: 'fc2',
      workKind: 'file-change',
      change: {
        path: 'nested/foo.md',
        kind: 'add',
        movePath: null,
        diff: null,
        diffStats: { added: 1, removed: 0 }
      },
      stdout: null,
      stderr: null,
      approvalStatus: null
    };
    const rows: ThreadTimelineViewRow[] = [
      {
        ...workBase,
        id: 'fc1',
        workKind: 'file-change',
        change: {
          path: 'src/old.md',
          kind: 'move',
          movePath: 'docs/new.md',
          diff: null,
          diffStats: { added: 0, removed: 0 }
        },
        stdout: null,
        stderr: null,
        approvalStatus: null
      },
      {
        ...workBase,
        id: 'fr1',
        workKind: 'file-read',
        path: 'README.md',
        cmd: null,
        completedAt: 2
      },
      {
        id: 'turn-closed',
        threadId: 't1',
        turnId: 'turn-0',
        sourceSeqStart: 0,
        sourceSeqEnd: 0,
        startedAt: 0,
        createdAt: 0,
        kind: 'turn',
        status: 'completed',
        summaryCount: 1,
        completedAt: 2,
        children: [nestedChange]
      }
    ];
    expect(collectTimelineFilePreviewPaths(rows)).toEqual([
      'src/old.md',
      'docs/new.md',
      'README.md',
      'nested/foo.md'
    ]);
  });
});

describe('reuseStringListIfEqual', () => {
  it('returns the previous array when contents match', () => {
    const previous = ['a.md', 'b.md'];
    expect(reuseStringListIfEqual(previous, ['a.md', 'b.md'])).toBe(previous);
  });

  it('returns the next array when contents differ', () => {
    const next = ['a.md'];
    expect(reuseStringListIfEqual(['a.md', 'b.md'], next)).toBe(next);
  });
});
