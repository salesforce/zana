import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('Inbox host action routing', () => {
  const detail = readFileSync(new URL('../InboxDetail.tsx', import.meta.url), 'utf8');
  const question = readFileSync(new URL('../InboxQuestionBlock.tsx', import.meta.url), 'utf8');
  const live = readFileSync(new URL('../../stores/live.ts', import.meta.url), 'utf8');
  const terminal = readFileSync(new URL('../AgentTerminalModal.tsx', import.meta.url), 'utf8');

  it('routes only main-listed entry ids to host IPC before existing reply paths', () => {
    expect(detail).toContain('useInboxHostActions((s) => s.byEntryId[entry.id])');
    expect(detail).toContain('(structuredQuestions || hostAction) ? inboxQuestions(entry) : []');
    expect(detail).toContain('(input: { optionId: string; text?: string }) => runInboxHostAction(entry.id, input)');
    expect(question).toContain('if (onHostAction) {');
    expect(question).toContain("} else if (entry.executionId && entry.blockerId) {");
    expect(live).toContain('if (!useInboxHostActions.getState().byEntryId[entryId]) return false;');
    expect(live).toContain('product.inbox.hostActions?.run(entryId, input)');
    expect(question).toContain('ok = await onHostAction({');
    expect(question).toContain("optionId === hostActionTextOptionId ? { text: hostActionText.trim() } : {}");
    expect(question).toContain('hostActionMessage && <p className="inbox-question-host-status" role="alert">{hostActionMessage}</p>');
    expect(question).toContain('disabled={busy || !canSend || hostActionUnavailable}');
    expect(question).toContain('return selected.length === 1 ? selected[0] : undefined;');
    expect(question).toContain('hostOwned\n    && selectedHostOptionId !== undefined');
  });

  it('does not derive host authority from inbox entry fields', () => {
    expect(live).toContain('const get = product.inbox.hostActions?.get;');
    expect(live).toContain('await get(entry.id)');
    expect(live).not.toContain('entry.hostAction)');
    expect(detail).toContain('void resolveInboxHostAction(entry);');
    expect(live).toContain("if (entry.hostActionRequired) throw new Error('Host ownership lookup unavailable');");
    expect(live).toContain("resolveEntry(entry.id, generation, { resolved: true, action: null })");
  });

  it('never renders a host-owned entry as a terminal answer form', () => {
    expect(terminal).toContain('void resolveInboxHostAction(pending);');
    expect(terminal).toContain('if (ownership?.error || hostAction || pending.hostActionRequired)');
    expect(terminal).toContain('Answer this host action in Inbox.');
  });
});
