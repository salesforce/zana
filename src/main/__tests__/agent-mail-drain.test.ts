import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentMailDrainService, type AgentMailDrainDeps } from '../agent-mail-drain.js';

/**
 * Unit tests for the idle-edge mail-drain nudge — the half of the mesh that
 * makes a busy agent eventually learn it has queued peer mail.
 *
 * Load-bearing behaviours:
 *  - nudge ONLY on the edge INTO idle/done, never on `blocked` or `working`;
 *  - announce-only: it injects a "run agent_inbox" line, never the bodies, and
 *    never mutates the queue (no markDelivered);
 *  - idempotent: the same backlog isn't re-announced on every idle flicker, but
 *    genuinely-new mail arriving while idle→busy→idle IS announced.
 */
describe('AgentMailDrainService', () => {
  let queue: Record<string, { id: string; fromHandle: string }[]>;
  let reply: ReturnType<typeof vi.fn>;
  let deps: AgentMailDrainDeps;
  let svc: AgentMailDrainService;

  beforeEach(() => {
    queue = {};
    reply = vi.fn((_sessionId: string, _text: string): boolean => true);
    deps = {
      pending: (sessionId) => queue[sessionId] ?? [],
      reply: reply as AgentMailDrainDeps['reply']
    };
    svc = new AgentMailDrainService(deps);
  });

  it('nudges once on the edge into idle when mail is queued', () => {
    queue['s1'] = [{ id: 'm1', fromHandle: 'alice' }];
    svc.observe('s1', 'working');
    expect(reply).not.toHaveBeenCalled();
    svc.observe('s1', 'idle');
    expect(reply).toHaveBeenCalledTimes(1);
    const [sessionId, text] = reply.mock.calls[0];
    expect(sessionId).toBe('s1');
    expect(text).toContain('agent_inbox');
    expect(text).toContain('@alice');
    expect(text).toContain('1 unread');
    // The body is never injected — only a pointer to agent_inbox.
    expect(text).not.toContain('m1');
  });

  it('does not nudge while blocked or working', () => {
    queue['s1'] = [{ id: 'm1', fromHandle: 'alice' }];
    svc.observe('s1', 'blocked');
    svc.observe('s1', 'working');
    expect(reply).not.toHaveBeenCalled();
  });

  it('does not nudge when the queue is empty', () => {
    svc.observe('s1', 'idle');
    expect(reply).not.toHaveBeenCalled();
  });

  it('does not re-announce the same backlog on repeated idle edges', () => {
    queue['s1'] = [{ id: 'm1', fromHandle: 'alice' }];
    svc.observe('s1', 'idle');
    svc.observe('s1', 'working');
    svc.observe('s1', 'idle'); // same single message still queued
    expect(reply).toHaveBeenCalledTimes(1);
  });

  it('announces again when new mail arrives after the first nudge', () => {
    queue['s1'] = [{ id: 'm1', fromHandle: 'alice' }];
    svc.observe('s1', 'idle');
    expect(reply).toHaveBeenCalledTimes(1);
    svc.observe('s1', 'working');
    // A second peer message lands while busy.
    queue['s1'] = [
      { id: 'm1', fromHandle: 'alice' },
      { id: 'm2', fromHandle: 'bob' }
    ];
    svc.observe('s1', 'idle');
    expect(reply).toHaveBeenCalledTimes(2);
    expect(reply.mock.calls[1][1]).toContain('2 unread');
  });

  it('re-announces a backlog if it was drained and the same id reappears later', () => {
    queue['s1'] = [{ id: 'm1', fromHandle: 'alice' }];
    svc.observe('s1', 'idle');
    expect(reply).toHaveBeenCalledTimes(1);
    // Agent drains via agent_inbox: queue empties. A later idle edge clears the
    // announced memory.
    queue['s1'] = [];
    svc.observe('s1', 'working');
    svc.observe('s1', 'idle');
    expect(reply).toHaveBeenCalledTimes(1);
    // Brand-new mail arrives.
    queue['s1'] = [{ id: 'm2', fromHandle: 'bob' }];
    svc.observe('s1', 'working');
    svc.observe('s1', 'idle');
    expect(reply).toHaveBeenCalledTimes(2);
  });

  it('does not record an announcement when the inject fails (session gone)', () => {
    reply.mockReturnValue(false);
    queue['s1'] = [{ id: 'm1', fromHandle: 'alice' }];
    svc.observe('s1', 'idle');
    expect(reply).toHaveBeenCalledTimes(1);
    // Failed nudge isn't remembered, so the next idle edge retries.
    reply.mockReturnValue(true);
    svc.observe('s1', 'working');
    svc.observe('s1', 'idle');
    expect(reply).toHaveBeenCalledTimes(2);
  });

  it('also nudges on the done state', () => {
    queue['s1'] = [{ id: 'm1', fromHandle: 'alice' }];
    svc.observe('s1', 'done');
    expect(reply).toHaveBeenCalledTimes(1);
  });

  it('nudges once on the edge into waiting (non-OSC harness rest state)', () => {
    queue['s1'] = [{ id: 'm1', fromHandle: 'alice' }];
    svc.observe('s1', 'working');
    expect(reply).not.toHaveBeenCalled();
    svc.observe('s1', 'waiting');
    expect(reply).toHaveBeenCalledTimes(1);
    const [sessionId, text] = reply.mock.calls[0];
    expect(sessionId).toBe('s1');
    expect(text).toContain('agent_inbox');
    expect(text).toContain('@alice');
  });

  it('does not nudge on the edge into blocked', () => {
    queue['s1'] = [{ id: 'm1', fromHandle: 'alice' }];
    svc.observe('s1', 'working');
    svc.observe('s1', 'blocked');
    expect(reply).not.toHaveBeenCalled();
  });
});
