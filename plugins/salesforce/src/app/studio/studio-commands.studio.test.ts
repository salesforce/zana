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
    ['trace.focus', {}], ['graph.focus', { node: 'n' }], ['layout.set', { compact: true }], ['orgTests.open', {}], ['simulations.open', {}], ['context.set', { presetId: 'p' }]
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

describe('context.set', () => {
  it('passes values, merge or a preset to the Context tab', async () => {
    const contextSet = vi.fn(() => ({ ok: true }));
    const { exec } = setup({ contextSet } as Partial<StudioCommandTargets>);
    const values = [{ name: 'verified', type: 'Boolean', value: true }];
    await exec('context.set', { values });
    expect(contextSet).toHaveBeenLastCalledWith({ values });
    await exec('context.set', { values, merge: true });
    expect(contextSet).toHaveBeenLastCalledWith({ values, merge: true });
    await exec('context.set', { presetId: 'p-1' });
    expect(contextSet).toHaveBeenLastCalledWith({ presetId: 'p-1' });
    await expect(exec('context.set', { values, presetId: 'p-1' })).rejects.toThrow();
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
    const contextVariables = [{ name: 'verified', type: 'Boolean', value: false }];
    await exec('preview.start', { contextVariables });
    expect(targets.preview.start).toHaveBeenLastCalledWith({ engine: undefined, contextVariables });
    await exec('preview.start', { presetId: 'p-1' });
    expect(targets.preview.start).toHaveBeenLastCalledWith({ engine: undefined, presetId: 'p-1' });
    await expect(exec('preview.start', { contextVariables: [{ name: 'verified', type: 'Boolean', value: 'false' }] })).rejects.toThrow('Boolean');
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

describe('orgTests.open', () => {
  it('opens the Org tests tab on an optional definition and run', async () => {
    const orgTestsOpen = vi.fn();
    const { exec } = setup({ orgTestsOpen });
    expect(await exec('orgTests.open', {})).toEqual({});
    expect(orgTestsOpen).toHaveBeenLastCalledWith({});
    expect(await exec('orgTests.open', { name: 'Support_Regression', runId: '4KB000000000001AAA' })).toEqual({ name: 'Support_Regression', runId: '4KB000000000001AAA' });
    expect(orgTestsOpen).toHaveBeenLastCalledWith({ name: 'Support_Regression', runId: '4KB000000000001AAA' });
  });
  it.each([
    [{ other: 1 }, 'accepts only name and runId'],
    [{ name: '1bad' }, 'API name'],
    [{ name: 7 }, 'API name'],
    [{ runId: 'short' }, '15 to 18'],
    [{ runId: 15 }, '15 to 18']
  ])('rejects %o', async (input, message) => {
    const orgTestsOpen = vi.fn();
    await expect(setup({ orgTestsOpen }).exec('orgTests.open', input)).rejects.toThrow(message);
    expect(orgTestsOpen).not.toHaveBeenCalled();
  });
});

describe('simulations.open', () => {
  it.each([{}, { batchId: 'batch-123' }, { batchId: 'a'.repeat(64) }])('opens Tests with optional batch focus %o', async input => {
    const simulationsOpen = vi.fn();
    const { exec } = setup({ simulationsOpen });
    await expect(exec('simulations.open', input)).resolves.toEqual(input);
    expect(simulationsOpen).toHaveBeenCalledExactlyOnceWith(input);
  });

  it.each([
    [{ batchId: '' }, 'batchId must be'],
    [{ batchId: '../other' }, 'batchId must be'],
    [{ batchId: 'a'.repeat(65) }, 'batchId must be'],
    [{ batchId: 7 }, 'batchId must be'],
    [{ batchId: 'batch-123', other: true }, 'accepts only batchId']
  ])('rejects invalid focus %o before opening Tests', async (input, error) => {
    const simulationsOpen = vi.fn();
    await expect(setup({ simulationsOpen }).exec('simulations.open', input)).rejects.toThrow(error);
    expect(simulationsOpen).not.toHaveBeenCalled();
  });
});
