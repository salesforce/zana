import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('AgentReportPanel', () => {
  it('reuses InboxEntryBody for the selected report', () => {
    const source = readFileSync(new URL('./AgentReportPanel.tsx', import.meta.url), 'utf8');
    expect(source).toContain('<InboxEntryBody');
    expect(source).toContain('sessionId === sessionId && isReport(e)');
  });
});
