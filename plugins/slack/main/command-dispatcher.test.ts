import { describe, it, expect, vi } from 'vitest';
import { parseCommand, CommandDispatcher } from './command-dispatcher.js';
import type { InboundSlackMessage } from '../shared/types.js';

describe('parseCommand', () => {
  it('parses run with a prompt', () => {
    expect(parseCommand('run fix the failing test')).toEqual({
      kind: 'run',
      prompt: 'fix the failing test'
    });
  });

  it('run with no prompt is unknown', () => {
    expect(parseCommand('run')).toEqual({ kind: 'unknown', raw: 'run' });
  });

  it('is case-insensitive on the verb', () => {
    expect(parseCommand('STATUS')).toEqual({ kind: 'status' });
    expect(parseCommand('Help')).toEqual({ kind: 'help' });
  });

  it('maps aliases', () => {
    expect(parseCommand('stop')).toEqual({ kind: 'cancel' });
  });

  it('parses hint with text', () => {
    expect(parseCommand('hint look in src/auth')).toEqual({ kind: 'hint', text: 'look in src/auth' });
  });

  it('blank → empty, garbage → unknown', () => {
    expect(parseCommand('   ')).toEqual({ kind: 'empty' });
    expect(parseCommand('floop the bork')).toEqual({ kind: 'unknown', raw: 'floop the bork' });
  });
});

describe('CommandDispatcher', () => {
  const m = (text: string): InboundSlackMessage => ({ user: 'U1', ts: '1.0', text });

  it('run enqueues a launch and acks in-thread', async () => {
    const enqueueLaunch = vi.fn().mockReturnValue('launch-1');
    const postReply = vi.fn().mockResolvedValue(undefined);
    const d = new CommandDispatcher({ enqueueLaunch, enqueueReply: vi.fn(), statusText: () => 'status' });

    await d.dispatch(m('run do the thing'), 'C1', 'P1', postReply);

    expect(enqueueLaunch).toHaveBeenCalledWith({ prompt: 'do the thing', channel: 'C1', parentTs: 'P1' });
    expect(postReply).toHaveBeenCalledTimes(1);
    expect(postReply.mock.calls[0][0]).toContain('do the thing');
  });

  it('status replies with the status text', async () => {
    const postReply = vi.fn().mockResolvedValue(undefined);
    const d = new CommandDispatcher({ enqueueLaunch: vi.fn(), enqueueReply: vi.fn(), statusText: () => 'BOT-OK' });
    await d.dispatch(m('status'), 'C1', 'P1', postReply);
    expect(postReply).toHaveBeenCalledWith('BOT-OK');
  });

  it('hint enqueues the text as a reply into the thread session', async () => {
    const enqueueReply = vi.fn();
    const postReply = vi.fn().mockResolvedValue(undefined);
    const d = new CommandDispatcher({ enqueueLaunch: vi.fn(), enqueueReply, statusText: () => 's' });

    await d.dispatch(m('hint look in src/auth'), 'C1', 'P1', postReply);

    expect(enqueueReply).toHaveBeenCalledWith({
      channel: 'C1',
      parentTs: 'P1',
      text: 'look in src/auth',
      label: 'hint'
    });
  });

  it('cancel enqueues an Esc reply into the thread session', async () => {
    const enqueueReply = vi.fn();
    const postReply = vi.fn().mockResolvedValue(undefined);
    const d = new CommandDispatcher({ enqueueLaunch: vi.fn(), enqueueReply, statusText: () => 's' });

    await d.dispatch(m('cancel'), 'C1', 'P1', postReply);

    expect(enqueueReply).toHaveBeenCalledTimes(1);
    const arg = enqueueReply.mock.calls[0][0];
    expect(arg).toMatchObject({ channel: 'C1', parentTs: 'P1', label: 'cancel', raw: true });
    expect(arg.text).toBe(String.fromCharCode(27)); // Esc
  });

  it('hint is NOT raw (submitted as a line)', async () => {
    const enqueueReply = vi.fn();
    const d = new CommandDispatcher({ enqueueLaunch: vi.fn(), enqueueReply, statusText: () => 's' });
    await d.dispatch(m('hint do x'), 'C1', 'P1', vi.fn().mockResolvedValue(undefined));
    expect(enqueueReply.mock.calls[0][0].raw).toBeFalsy();
  });

  it('empty message stays silent', async () => {
    const postReply = vi.fn().mockResolvedValue(undefined);
    const d = new CommandDispatcher({ enqueueLaunch: vi.fn(), enqueueReply: vi.fn(), statusText: () => 's' });
    await d.dispatch(m('   '), 'C1', 'P1', postReply);
    expect(postReply).not.toHaveBeenCalled();
  });
});
