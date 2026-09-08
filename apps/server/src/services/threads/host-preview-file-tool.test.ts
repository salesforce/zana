import { afterEach, describe, expect, it, vi } from 'vitest';
import { HOST_SESSION_TOOLS_MAX } from '../../plugins/plugin-agent-tools.js';
import {
  HOST_PREVIEW_FILE_INSTRUCTION,
  HOST_PREVIEW_FILE_TOOL,
  HOST_PREVIEW_FILE_TOOL_NAME,
  invokeHostPreviewFileTool,
  mergeHostPreviewFileTooling,
  PREVIEW_FILE_DESCRIPTION
} from './host-preview-file-tool.js';
import { PreviewFileError } from './preview-file.js';

vi.mock('./preview-file.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./preview-file.js')>();
  return {
    ...actual,
    previewFileDepsFromContext: () => ({ tagged: 'deps' }),
    openThreadFilePreview: vi.fn()
  };
});

import { openThreadFilePreview } from './preview-file.js';

afterEach(() => {
  vi.mocked(openThreadFilePreview).mockReset();
});

describe('mergeHostPreviewFileTooling', () => {
  it('tells the agent to use the side-panel preview instead of Cursor', () => {
    expect(PREVIEW_FILE_DESCRIPTION).toContain('side-panel preview');
    expect(PREVIEW_FILE_DESCRIPTION).toContain('Do not open files in Cursor');
    expect(HOST_PREVIEW_FILE_INSTRUCTION).toContain('preview_file');
    expect(HOST_PREVIEW_FILE_INSTRUCTION).toContain('Do not open files in Cursor');
  });

  it('offers preview_file even when no plugin tools are packed', () => {
    expect(mergeHostPreviewFileTooling({})).toEqual({
      dynamicTools: [HOST_PREVIEW_FILE_TOOL],
      instructions: HOST_PREVIEW_FILE_INSTRUCTION
    });
  });

  it('keeps host preview_file ahead of plugin tools and wins name collisions', () => {
    const packed = mergeHostPreviewFileTooling({
      dynamicTools: [
        { name: HOST_PREVIEW_FILE_TOOL_NAME, description: 'plugin copy', inputSchema: {} },
        { name: 'sf_soql', description: 'SOQL', inputSchema: { type: 'object' } }
      ],
      instructions: 'Use sf_soql.'
    });
    expect(packed.dynamicTools?.map((tool) => tool.name)).toEqual([
      HOST_PREVIEW_FILE_TOOL_NAME,
      'sf_soql'
    ]);
    expect(packed.dynamicTools?.[0]?.description).toBe(PREVIEW_FILE_DESCRIPTION);
    expect(packed.instructions).toBe(`${HOST_PREVIEW_FILE_INSTRUCTION}\n\nUse sf_soql.`);
  });

  it('still fits the session tool cap after prepending the host tool', () => {
    const packed = mergeHostPreviewFileTooling({
      dynamicTools: Array.from({ length: HOST_SESSION_TOOLS_MAX }, (_, index) => ({
        name: `t${index}`,
        description: 'd',
        inputSchema: {}
      }))
    });
    expect(packed.dynamicTools).toHaveLength(HOST_SESSION_TOOLS_MAX);
    expect(packed.dynamicTools?.[0]?.name).toBe(HOST_PREVIEW_FILE_TOOL_NAME);
  });
});

describe('invokeHostPreviewFileTool', () => {
  it('opens through the owning thread id and ignores a forged threadId field', () => {
    vi.mocked(openThreadFilePreview).mockReturnValue({
      delivered: 1,
      path: 'src/a.ts',
      source: 'workspace',
      threadId: 'thr-1',
      projectId: 'proj-1'
    });
    const result = invokeHostPreviewFileTool({} as never, {
      threadId: 'thr-1',
      projectId: 'proj-1',
      input: { path: 'src/a.ts', threadId: 'other-thread', lineNumber: 4 }
    });
    expect(result.success).toBe(true);
    expect(JSON.parse(result.contentItems[0]?.text ?? '{}')).toEqual({
      ok: true,
      path: 'src/a.ts',
      source: 'workspace'
    });
    expect(openThreadFilePreview).toHaveBeenCalledWith(
      { tagged: 'deps' },
      {
        threadId: 'thr-1',
        projectId: 'proj-1',
        source: 'workspace',
        path: 'src/a.ts',
        lineNumber: 4
      }
    );
  });

  it('errors when no app window is connected', () => {
    vi.mocked(openThreadFilePreview).mockReturnValue({
      delivered: 0,
      path: 'src/a.ts',
      source: 'workspace',
      threadId: 'thr-1',
      projectId: 'proj-1'
    });
    const result = invokeHostPreviewFileTool({} as never, {
      threadId: 'thr-1',
      projectId: 'proj-1',
      input: { path: 'src/a.ts' }
    });
    expect(result.success).toBe(false);
    expect(result.contentItems[0]?.text).toContain('desktop app open');
  });

  it('maps confinement failures to an unsuccessful tool result', () => {
    vi.mocked(openThreadFilePreview).mockImplementation(() => {
      throw new PreviewFileError(403, 'path-escape', 'path is not inside the thread workspace');
    });
    const result = invokeHostPreviewFileTool({} as never, {
      threadId: 'thr-1',
      projectId: 'proj-1',
      input: { path: '../secret.txt' }
    });
    expect(result.success).toBe(false);
    expect(result.contentItems[0]?.text).toContain('path is not inside the thread workspace');
  });

  it('rejects a missing path', () => {
    const result = invokeHostPreviewFileTool({} as never, {
      threadId: 'thr-1',
      projectId: 'proj-1',
      input: {}
    });
    expect(result.success).toBe(false);
    expect(openThreadFilePreview).not.toHaveBeenCalled();
  });

  it('rejects a non-object payload, overlong path, and unknown source', () => {
    expect(invokeHostPreviewFileTool({} as never, {
      threadId: 'thr-1',
      projectId: 'proj-1',
      input: null
    }).success).toBe(false);
    expect(invokeHostPreviewFileTool({} as never, {
      threadId: 'thr-1',
      projectId: 'proj-1',
      input: { path: 'a'.repeat(1025) }
    }).success).toBe(false);
    expect(invokeHostPreviewFileTool({} as never, {
      threadId: 'thr-1',
      projectId: 'proj-1',
      input: { path: 'src/a.ts', source: 'elsewhere' }
    }).success).toBe(false);
    expect(invokeHostPreviewFileTool({} as never, {
      threadId: 'thr-1',
      projectId: 'proj-1',
      input: []
    }).success).toBe(false);
    expect(invokeHostPreviewFileTool({} as never, {
      threadId: 'thr-1',
      projectId: 'proj-1',
      input: { path: '   ' }
    }).success).toBe(false);
    expect(openThreadFilePreview).not.toHaveBeenCalled();
  });

  it('opens a thread-storage path and maps a thrown string to an unsuccessful result', () => {
    vi.mocked(openThreadFilePreview).mockReturnValueOnce({
      delivered: 1,
      path: 'notes.md',
      source: 'thread-storage',
      threadId: 'thr-1',
      projectId: 'proj-1'
    });
    const opened = invokeHostPreviewFileTool({} as never, {
      threadId: 'thr-1',
      projectId: 'proj-1',
      input: { path: 'notes.md', source: 'thread-storage' }
    });
    expect(opened.success).toBe(true);
    expect(openThreadFilePreview).toHaveBeenCalledWith(
      { tagged: 'deps' },
      expect.objectContaining({ source: 'thread-storage', path: 'notes.md', lineNumber: null })
    );

    vi.mocked(openThreadFilePreview).mockImplementationOnce(() => {
      throw 'preview failed';
    });
    const failed = invokeHostPreviewFileTool({} as never, {
      threadId: 'thr-1',
      projectId: 'proj-1',
      input: { path: 'src/a.ts' }
    });
    expect(failed.success).toBe(false);
    expect(failed.contentItems[0]?.text).toContain('preview failed');
  });
});
