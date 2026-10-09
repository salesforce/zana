import { describe, expect, it, vi } from 'vitest';
import { createStudioCommandExecutor, type StudioCommandTargets } from './studio/studio-commands.js';

function setup(overrides: Partial<StudioCommandTargets> = {}) {
  const targets = {
    getSource: vi.fn(() => 'SRC'),
    isBusyOrDirty: vi.fn(() => false),
    refreshFiles: vi.fn(async () => undefined),
    openFile: vi.fn(async () => true),
    setFileQuery: vi.fn(),
    revealLine: vi.fn(),
    tools: { openTool: vi.fn(), close: vi.fn(), setOpen: vi.fn() },
    ...overrides
  } as unknown as StudioCommandTargets & { tools: { openTool: any; close: any; setOpen: any } };
  const run = createStudioCommandExecutor(targets);
  const exec = (command: string, input: Record<string, unknown> = {}) => run({ id: 'c', command, input } as any);
  return { targets, exec };
}

describe('createStudioCommandExecutor', () => {
  it('returns source only on request', async () => {
    const { exec } = setup();
    expect(await exec('state')).toEqual({});
    expect(await exec('state', { includeSource: true })).toEqual({ source: 'SRC' });
  });
  it('opens files after refreshing, refusing while dirty or when open fails', async () => {
    const { exec, targets } = setup();
    expect(await exec('file.open', { path: 'a.agent' })).toEqual({ path: 'a.agent' });
    expect(targets.refreshFiles).toHaveBeenCalled();
    expect(targets.openFile).toHaveBeenCalledWith('a.agent');
    await expect(exec('file.open', {})).rejects.toThrow('path');
    targets.openFile = vi.fn(async () => false) as any;
    await expect(exec('file.open', { path: 'b.agent' })).rejects.toThrow('Could not open');
    const dirty = setup({ isBusyOrDirty: () => true });
    await expect(dirty.exec('file.open', { path: 'a.agent' })).rejects.toThrow('Save the current draft');
  });
  it('filters files and opens the files tool', async () => {
    const { exec, targets } = setup();
    await exec('file.filter', { query: 'help' });
    expect(targets.setFileQuery).toHaveBeenCalledWith('help');
    expect(targets.tools.openTool).toHaveBeenCalledWith('files');
    await expect(exec('file.filter', { query: 'x'.repeat(201) })).rejects.toThrow('query');
  });
  it('reveals positive integer lines only', async () => {
    const { exec, targets } = setup();
    expect(await exec('editor.reveal', { line: 7 })).toEqual({ revealedLine: 7 });
    expect(targets.revealLine).toHaveBeenCalledWith(7);
    for (const line of [0, 1.5, '3', undefined]) await expect(exec('editor.reveal', { line })).rejects.toThrow('positive');
  });
  it('shows, hides, opens and closes the tool panel', async () => {
    const { exec, targets } = setup();
    await exec('panel.show'); expect(targets.tools.setOpen).toHaveBeenLastCalledWith(true);
    await exec('panel.hide'); expect(targets.tools.setOpen).toHaveBeenLastCalledWith(false);
    await exec('panel.open', { tool: 'graph' }); expect(targets.tools.openTool).toHaveBeenCalledWith('graph');
    await exec('panel.close', { tool: 'graph' }); expect(targets.tools.close).toHaveBeenCalledWith('graph');
    await expect(exec('panel.open', { tool: 'nope' })).rejects.toThrow('known');
  });
});
