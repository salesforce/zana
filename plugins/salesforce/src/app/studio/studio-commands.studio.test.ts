import { describe, expect, it, vi } from 'vitest';
import { createStudioCommandExecutor, type StudioCommandTargets } from './studio-commands.js';
import type { ProposalOutcome } from '../../../lib/studio-contract.js';

const sha = 'c'.repeat(64);
const proposal = { path: 'a.agent', expectedSha256: sha, content: 'new', summary: 'tidy' };
const accepted: ProposalOutcome = { outcome: 'accepted', acceptedHunks: 1, rejectedHunks: 0 };

function setup(over: Partial<StudioCommandTargets> = {}) {
  const base = {
    getSource: () => '', isBusyOrDirty: vi.fn(() => false), refreshFiles: vi.fn(async () => {}), openFile: vi.fn(async () => true),
    setFileQuery: vi.fn(), revealLine: vi.fn(), tools: { openTool: vi.fn(), close: vi.fn(), setOpen: vi.fn() }, ...over
  } as unknown as StudioCommandTargets;
  const run = createStudioCommandExecutor(base);
  return { base, exec: (command: string, input: Record<string, unknown> = {}) => run({ id: 'c', command, input } as any) };
}

describe('Studio verbs report unsupported when the target is absent', () => {
  it.each([
    ['editor.proposeEdit', proposal], ['preview.start', {}], ['preview.send', { text: 'hi' }],
    ['trace.focus', {}], ['graph.focus', { node: 'n' }], ['layout.set', { compact: true }]
  ])('%s', async (command, input) => {
    await expect(setup().exec(command, input)).rejects.toThrow(`${command} is not supported in this view.`);
  });
  it('validates input before checking support', async () => {
    await expect(setup().exec('layout.set', { compact: 'x' })).rejects.toThrow('boolean');
  });
});

describe('editor.proposeEdit', () => {
  const proposeEdit = (path: string | null, sha256: string | undefined, settled: Promise<ProposalOutcome> = Promise.resolve(accepted)) => ({
    current: vi.fn(() => ({ path, sha256 })), start: vi.fn(() => settled)
  });
  it('starts the proposal and returns a pending-user result carrying the settled outcome', async () => {
    const target = proposeEdit('a.agent', sha);
    const { exec } = setup({ proposeEdit: target });
    const result = await exec('editor.proposeEdit', proposal) as any;
    expect(result).toMatchObject({ pending: 'user', proposalId: expect.any(String), path: 'a.agent' });
    expect(target.start).toHaveBeenCalledWith(proposal, result.proposalId);
    await expect(result.settled).resolves.toEqual(accepted);
  });
  it('swallows rejection on its own branch so the hook can report it', async () => {
    const { exec } = setup({ proposeEdit: proposeEdit('a.agent', sha, Promise.reject(Error('closed'))) });
    const result = await exec('editor.proposeEdit', proposal) as any;
    await expect(result.settled).rejects.toThrow('closed');
  });
  it('refuses on sha mismatch', async () => {
    const { exec } = setup({ proposeEdit: proposeEdit('a.agent', 'd'.repeat(64)) });
    await expect(exec('editor.proposeEdit', proposal)).rejects.toThrow('changed since');
  });
  it('refuses to switch files while dirty', async () => {
    const target = proposeEdit('other.agent', sha);
    const { exec, base } = setup({ proposeEdit: target, isBusyOrDirty: () => true });
    await expect(exec('editor.proposeEdit', proposal)).rejects.toThrow('Save the current draft');
    expect(base.openFile).not.toHaveBeenCalled();
    expect(target.start).not.toHaveBeenCalled();
  });
  it('opens the target file when clean and then validates the revision', async () => {
    let path = 'other.agent';
    const target = { current: vi.fn(() => ({ path, sha256: sha })), start: vi.fn(async () => accepted) };
    const { exec, base } = setup({ proposeEdit: target, openFile: vi.fn(async () => { path = 'a.agent'; return true; }) });
    await exec('editor.proposeEdit', proposal);
    expect(base.refreshFiles).toHaveBeenCalled();
    expect(base.openFile).toHaveBeenCalledWith('a.agent');
  });
  it('fails when the file cannot be opened or does not become current', async () => {
    const closed = setup({ proposeEdit: proposeEdit('x', sha), openFile: vi.fn(async () => false) as any });
    await expect(closed.exec('editor.proposeEdit', proposal)).rejects.toThrow('Could not open');
    const stuck = setup({ proposeEdit: proposeEdit('x', sha) });
    await expect(stuck.exec('editor.proposeEdit', proposal)).rejects.toThrow('not open');
  });
  it('rejects invalid proposals', async () => {
    const { exec } = setup({ proposeEdit: proposeEdit('a.agent', sha) });
    await expect(exec('editor.proposeEdit', { ...proposal, expectedSha256: 'abc' })).rejects.toThrow('expectedSha256');
  });
  it('falls back to a counter id when crypto.randomUUID is unavailable', async () => {
    const original = globalThis.crypto;
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
    try {
      const result = await setup({ proposeEdit: proposeEdit('a.agent', sha) }).exec('editor.proposeEdit', proposal) as any;
      expect(result.proposalId).toMatch(/^proposal-/);
    } finally { Object.defineProperty(globalThis, 'crypto', { value: original, configurable: true }); }
  });
});

describe('preview, trace, graph and layout verbs', () => {
  it('delegates to the optional targets', async () => {
    const targets = {
      preview: { start: vi.fn(async () => ({ runId: 'r' })), send: vi.fn(() => ({ turn: 1 })) },
      traceFocus: vi.fn(), graphFocus: vi.fn(() => ({ node: 'n' })), layoutSet: vi.fn()
    };
    const { exec } = setup(targets);
    expect(await exec('preview.start', { engine: 'simulate' })).toEqual({ runId: 'r' });
    expect(targets.preview.start).toHaveBeenCalledWith({ engine: 'simulate' });
    expect(await exec('preview.send', { text: 'hello' })).toEqual({ turn: 1 });
    expect(targets.preview.send).toHaveBeenCalledWith({ text: 'hello', engine: undefined });
    await exec('trace.focus', { runId: 'r', turn: 2, step: 3 });
    expect(targets.traceFocus).toHaveBeenCalledWith({ runId: 'r', turn: 2, step: 3 });
    expect(await exec('graph.focus', { node: 'n' })).toEqual({ node: 'n' });
    expect(await exec('layout.set', { compact: true })).toEqual({ compact: true });
    expect(targets.layoutSet).toHaveBeenCalledWith(true);
    await exec('layout.set', { compact: false });
    expect(targets.layoutSet).toHaveBeenLastCalledWith(false);
  });
});
