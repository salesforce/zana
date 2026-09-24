import { expect, it } from 'vitest';
import type { TimelineRow } from '@zana-ai/zcc-server-contract';
import { threadHistoryTranscript } from './thread-history-transcript.js';

const message = (text: string, role = 'assistant') => ({ kind: 'conversation', role, text }) as TimelineRow;

it('keeps conversation order across turns without exposing tool output or child threads', () => {
  const rows = [message('Question', 'user'), { kind: 'turn', children: [
    message('Thinking aloud'), { kind: 'work', workKind: 'command', output: 'private tool payload' }
  ] }, { kind: 'turn', children: null }, { kind: 'work', workKind: 'delegation', childRows: [message('Child message')] }, message('Answer'), message('  ')] as TimelineRow[];
  expect(threadHistoryTranscript(rows)).toEqual({ messages: [
    { role: 'user', text: 'Question' }, { role: 'assistant', text: 'Thinking aloud' }, { role: 'assistant', text: 'Answer' }
  ], truncated: false });
});

it('labels paged or shortened previews and caps individual messages, total text and message count', () => {
  expect(threadHistoryTranscript([], true).truncated).toBe(true);
  const long = threadHistoryTranscript([message('x'.repeat(64_001))]);
  expect(long.messages[0].text).toHaveLength(64_000); expect(long.truncated).toBe(true);
  const many = threadHistoryTranscript(Array.from({ length: 501 }, () => message('x')));
  expect(many.messages).toHaveLength(500); expect(many.truncated).toBe(true);
  const total = threadHistoryTranscript(Array.from({ length: 20 }, () => message('x'.repeat(64_000))));
  expect(total.messages.reduce((sum, entry) => sum + entry.text.length, 0)).toBe(1_000_000);
  expect(total.truncated).toBe(true);
});
