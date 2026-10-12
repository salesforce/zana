import { describe, expect, it } from 'vitest';
import { commandAuthor, holdCommand, holdReason, revealLabel, TYPING_IDLE_MS } from './follow-gate.js';
import type { UiCommand } from '../../../lib/workbench-control.js';

const cmd = (command: string, input: Record<string, unknown> = {}, from?: UiCommand['from']): UiCommand => ({ id: 'c', command: command as UiCommand['command'], input, ...(from ? { from } : {}) });

describe('follow gate', () => {
  it('holds only reveals, when paused or while the user is still typing', () => {
    const idle = { paused: false, lastEditAt: 0, now: 10_000 };
    expect(holdReason(cmd('editor.reveal', { line: 2 }), idle)).toBeNull();
    expect(holdReason(cmd('editor.reveal', { line: 2 }), { ...idle, paused: true })).toBe('paused');
    expect(holdReason(cmd('file.open', { path: 'a.agent' }), { ...idle, lastEditAt: 10_000 - TYPING_IDLE_MS + 1 })).toBe('typing');
    expect(holdReason(cmd('trace.focus'), { ...idle, lastEditAt: 10_000 - TYPING_IDLE_MS })).toBeNull();
    // The person's own click in another window applies even while paused or typing.
    expect(holdReason({ ...cmd('file.open', { path: 'a.agent' }), user: true }, { paused: true, lastEditAt: 10_000, now: 10_000 })).toBeNull();
    // Bad input is never held: the executor rejects it at once.
    const paused = { paused: true, lastEditAt: 0, now: 10_000 };
    expect(holdReason(cmd('editor.reveal', { line: 0 }), paused)).toBeNull();
    expect(holdReason(cmd('editor.reveal', { line: 1.5 }), paused)).toBeNull();
    expect(holdReason(cmd('file.open', { path: '' }), paused)).toBeNull();
    expect(holdReason(cmd('file.open', { path: 'a'.repeat(4001) }), paused)).toBeNull();
    expect(holdReason(cmd('graph.focus', { node: ' ' }), paused)).toBeNull();
    // A file switch over an unsaved draft is refused at once, not held behind the typing.
    expect(holdReason(cmd('file.open', { path: 'a.agent' }), { paused: false, lastEditAt: 10_000, now: 10_000, dirty: true })).toBeNull();
    expect(holdReason(cmd('file.open', { path: 'a.agent' }), { ...paused, dirty: true })).toBeNull();
    expect(holdReason(cmd('editor.reveal', { line: 2 }), { ...paused, dirty: true })).toBe('paused');
    expect(holdReason(cmd('graph.focus', { node: 'topic.main' }), paused)).toBe('paused');
    for (const name of ['editor.proposeEdit', 'preview.send', 'panel.open', 'layout.set', 'state']) {
      expect(holdReason(cmd(name), { paused: true, lastEditAt: 10_000, now: 10_000 })).toBeNull();
    }
  });

  it('labels the reveal and its author', () => {
    expect(revealLabel(cmd('file.open', { path: 'force-app/bots/Help.agent' }))).toBe('open Help.agent');
    expect(revealLabel(cmd('file.open', {}))).toBe('open a file');
    expect(revealLabel(cmd('editor.reveal', { line: 12 }))).toBe('go to line 12');
    expect(revealLabel(cmd('trace.focus'))).toBe('show the trace');
    expect(revealLabel(cmd('graph.focus', { node: 'topic.main' }))).toBe('show topic.main in the graph');
    expect(revealLabel(cmd('graph.focus', {}))).toBe('show the graph');
    expect(commandAuthor({ from: { threadId: 't', title: '  Fix QC ' } })).toBe('Fix QC');
    expect(commandAuthor({ from: { threadId: 't', title: '   ' } })).toBe('The agent');
    expect(commandAuthor({})).toBe('The agent');
    expect(holdCommand(cmd('editor.reveal', { line: 3 }, { threadId: 't', title: 'Fix' }), 'typing')).toMatchObject({ reason: 'typing', label: 'go to line 3', who: 'Fix' });
  });
});
