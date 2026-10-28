import { describe, expect, it } from 'vitest';
import { buildConversationDigest } from './conversation-digest.js';

describe('buildConversationDigest', () => {
  it('is empty for an empty thread and drops blank messages', () => {
    expect(buildConversationDigest([])).toBe('');
    expect(buildConversationDigest([{ role: 'user', text: '  ' }])).toBe('');
  });

  it('tags each message by role, separated by blank lines, in order', () => {
    expect(buildConversationDigest([
      { role: 'user', text: ' fix the bug ' },
      { role: 'assistant', text: 'Done.' },
      { role: 'user', text: 'thanks' }
    ])).toBe('User: fix the bug\n\nAssistant: Done.\n\nUser: thanks');
  });

  it('keeps the final assistant block to 4,000 characters and clamps every other block to 1,500', () => {
    const digest = buildConversationDigest([
      { role: 'user', text: 'u'.repeat(2_000) },
      { role: 'assistant', text: 'a'.repeat(2_000) },
      { role: 'assistant', text: 'z'.repeat(5_000) },
      { role: 'user', text: 'q'.repeat(10) }
    ]);
    const blocks = digest.split('\n\n');
    expect(blocks[0]).toBe(`User: ${'u'.repeat(1_500)}…`);
    expect(blocks[1]).toBe(`Assistant: ${'a'.repeat(1_500)}…`);
    expect(blocks[2]).toBe(`Assistant: ${'z'.repeat(4_000)}…`);
    expect(blocks[3]).toBe(`User: ${'q'.repeat(10)}`);
  });

  it('caps the whole digest at 12,000 characters, keeping the tail', () => {
    const messages = Array.from({ length: 20 }, (_, i) => ({ role: 'user' as const, text: `${i}`.padStart(2, '0') + 'x'.repeat(1_400) }));
    const digest = buildConversationDigest(messages);
    expect(digest).toHaveLength(12_000);
    expect(digest.endsWith('x'.repeat(100))).toBe(true);
    expect(digest).toContain('19xxx');
  });
});
