import { describe, expect, it } from 'vitest';
import { blockerCardSubject, humanBlockerDenial } from '../human-blocker-denial.js';
import type { ExecutionRecord } from '../store.js';

const intent = { key: 'execution-blocker:e1:b1', blockerId: 'b1', status: 'ACKNOWLEDGED' as const, attempts: 0, nextAttemptAt: 0, createdAt: 0, updatedAt: 0 };
const record = (extra: Partial<ExecutionRecord>) => ({ id: 'e1', ...extra }) as ExecutionRecord;

describe('humanBlockerDenial', () => {
  it('falls back to the default card subject when the job has no title', () => {
    expect(blockerCardSubject(record({}))).toBe('Job Execution Blocked');
    const text = humanBlockerDenial(record({ noticeIntents: [{ ...intent, inboxItemId: 'i-1' }] }), { id: 'b1' });
    expect(text).toContain('"Job Execution Blocked"');
    expect(text).toContain('Inbox entry i-1, blocker b1, execution e1');
  });

  it('names the card by subject and blocker id when no notice intent exists (kickoff blockers)', () => {
    const text = humanBlockerDenial(record({ jobTitle: 'Ship' }), { id: 'no-progress:1:a:1' });
    expect(text).toContain('"Ship" (blocker no-progress:1:a:1, execution e1)');
    expect(text).toContain("answer blocker no-progress:1:a:1 from the Squad's Execution board");
    expect(text).not.toContain('Inbox entry');
    expect(text).not.toContain('once its card appears');
  });

  it('tells two runs with the same job title apart by execution id', () => {
    const a = humanBlockerDenial(record({ id: 'e1', jobTitle: 'Ship', noticeIntents: [{ ...intent, inboxItemId: 'i-1' }] }), { id: 'b1' });
    const b = humanBlockerDenial(record({ id: 'e2', jobTitle: 'Ship', noticeIntents: [{ ...intent, inboxItemId: 'i-2' }] }), { id: 'b1' });
    expect(a).toContain('execution e1');
    expect(b).toContain('execution e2');
    expect(a).not.toBe(b);
  });

  it('shows the subject the way the Inbox heading does: one line, 200 chars', () => {
    const text = humanBlockerDenial(record({ jobTitle: `Line one\n\tline two ${'x'.repeat(400)}`, noticeIntents: [{ ...intent, inboxItemId: 'i-2' }] }), { id: 'b1' });
    const quoted = /card "([^"]*)"/.exec(text)![1]!;
    expect(quoted.startsWith('Line one line two x')).toBe(true);
    expect(quoted).toHaveLength(200);
  });

  it('does not promise a card to come for an acknowledged notice that has no Inbox entry id', () => {
    const text = humanBlockerDenial(record({ jobTitle: 'Ship', noticeIntents: [intent] }), { id: 'b1' });
    expect(text).not.toContain('once its card appears');
    expect(text).toContain('"Ship" (blocker b1, execution e1)');
  });

  it('says the card has not appeared when the notice has no Inbox entry', () => {
    const text = humanBlockerDenial(record({ jobTitle: 'Ship', noticeIntents: [{ ...intent, status: 'PENDING' }] }), { id: 'b1' });
    expect(text).toContain('once its card appears (blocker b1, execution e1)');
    expect(text).toContain("answer blocker b1 from the Squad's Execution board");
    expect(text).not.toContain('"Ship"');
  });

  it("points to the Squad's Execution board when the card may not exist (PENDING and fallback)", () => {
    const board = "if there is none, answer blocker b1 from the Squad's Execution board";
    const pending = humanBlockerDenial(record({ jobTitle: 'Ship', noticeIntents: [{ ...intent, status: 'PENDING' }] }), { id: 'b1' });
    const fallback = humanBlockerDenial(record({ jobTitle: 'Ship' }), { id: 'b1' });
    expect(pending).toContain(board);
    expect(fallback).toContain(board);
    const withCard = humanBlockerDenial(record({ jobTitle: 'Ship', noticeIntents: [{ ...intent, inboxItemId: 'i-1' }] }), { id: 'b1' });
    expect(withCard).not.toContain('Execution board');
  });
});
