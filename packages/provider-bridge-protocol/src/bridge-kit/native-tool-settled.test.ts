import { describe, expect, it, vi } from 'vitest';
import { createNativeToolSettledReporter, type BridgeNativeToolSettledNotification } from './native-tool-settled.js';

const report = { threadId: 't', providerThreadId: 'pt', callId: 'c', toolName: 'Bash', state: 'succeeded' as const };

describe('createNativeToolSettledReporter', () => {
  it('computes duration from the recorded start and consumes it', () => {
    const sent: BridgeNativeToolSettledNotification[] = [];
    let clock = 1_000;
    const r = createNativeToolSettledReporter((n) => sent.push(n), () => clock);
    r.started('t', 'c');
    clock = 1_250;
    r.settled(report);
    r.settled(report);
    expect(sent[0]!.method).toBe('tool/policy/settled');
    expect(sent[0]!.params.durationMs).toBe(250);
    expect(sent[1]!.params.durationMs).toBe(0);
  });

  it('measures output bytes, bounds the text, and omits empty output', () => {
    const sent: BridgeNativeToolSettledNotification[] = [];
    const r = createNativeToolSettledReporter((n) => sent.push(n));
    r.settled({ ...report, output: 'é' });
    r.settled({ ...report, output: 'x'.repeat(40_000) });
    r.settled({ ...report, output: '' });
    expect(sent[0]!.params).toMatchObject({ outputBytes: 2, output: 'é' });
    expect(sent[1]!.params.output).toHaveLength(32_768);
    expect(sent[2]!.params).not.toHaveProperty('output');
  });

  it('never throws when the transport fails, and forgets by thread', () => {
    const send = vi.fn(() => { throw new Error('closed'); });
    const r = createNativeToolSettledReporter(send, () => 5);
    r.started('t', 'c');
    r.forget('t');
    expect(() => r.settled(report)).not.toThrow();
    expect(send).toHaveBeenCalledOnce();
  });

  it('bounds remembered starts', () => {
    const sent: BridgeNativeToolSettledNotification[] = [];
    let clock = 0;
    const r = createNativeToolSettledReporter((n) => sent.push(n), () => clock, 1);
    r.started('t', 'a');
    clock = 10;
    r.started('t', 'b');
    clock = 30;
    r.settled({ ...report, callId: 'a' });
    r.settled({ ...report, callId: 'b' });
    expect(sent.map((n) => n.params.durationMs)).toEqual([0, 20]);
  });
});
