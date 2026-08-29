import { afterEach, describe, expect, it } from 'vitest';
import {
  bufferThreadOpenFile,
  consumePendingOpenFile,
  parseThreadOpenFilePayload,
  resetThreadOpenFileBuffer,
  tabFromOpenFile
} from './useThreadOpenFileSignal.js';

describe('thread-open file signal', () => {
  afterEach(() => {
    resetThreadOpenFileBuffer();
  });

  it('parses workspace and storage payloads and ignores malformed ones', () => {
    expect(parseThreadOpenFilePayload(null)).toBeNull();
    expect(parseThreadOpenFilePayload({ threadId: 't1', file: null })).toEqual({
      threadId: 't1',
      file: null
    });
    expect(parseThreadOpenFilePayload({
      threadId: 't1',
      file: { source: 'workspace', path: 'src/a.ts', lineNumber: 12 }
    })?.file).toEqual({ source: 'workspace', path: 'src/a.ts', lineNumber: 12 });
    expect(parseThreadOpenFilePayload({
      threadId: 't1',
      file: { source: 'thread-storage', path: 'notes/a.md', lineNumber: null }
    })?.file).toEqual({ source: 'thread-storage', path: 'notes/a.md', lineNumber: null });
  });

  it('buffers then drains the oldest file for a thread', () => {
    bufferThreadOpenFile('t1', { source: 'workspace', path: 'a.ts', lineNumber: null });
    bufferThreadOpenFile('t1', { source: 'thread-storage', path: 'b.md', lineNumber: 2 });
    expect(consumePendingOpenFile('missing')).toBeNull();
    expect(consumePendingOpenFile('t1')).toMatchObject({ path: 'a.ts' });
    expect(consumePendingOpenFile('t1')).toMatchObject({ path: 'b.md' });
    expect(consumePendingOpenFile('t1')).toBeNull();
  });

  it('maps intents onto file-preview and storage-preview tabs', () => {
    expect(tabFromOpenFile({ source: 'workspace', path: 'src/a.ts', lineNumber: null })).toEqual({
      kind: 'file-preview',
      title: 'a.ts',
      path: 'src/a.ts'
    });
    expect(tabFromOpenFile({ source: 'thread-storage', path: 'notes/plan.md', lineNumber: null })).toEqual({
      kind: 'storage-preview',
      title: 'plan.md',
      path: 'notes/plan.md'
    });
  });

  it('parses the hub thread-open payload an MCP preview emits', () => {
    expect(parseThreadOpenFilePayload({
      type: 'thread-open',
      projectId: 'p1',
      threadId: 't1',
      split: 'right',
      file: { source: 'workspace', path: 'src/a.ts', lineNumber: 3 }
    })).toEqual({
      threadId: 't1',
      file: { source: 'workspace', path: 'src/a.ts', lineNumber: 3 }
    });
  });
});
