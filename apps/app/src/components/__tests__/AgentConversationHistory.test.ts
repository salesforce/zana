import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ConversationHistorySnapshot } from '@zana-ai/zcc-domain/product';
import { historySnapshotForDisplay } from '../AgentConversationHistory.js';

const row = {
  historyId: 'opaque-row', source: 'claude' as const, title: 'Keep this conversation',
  lastActiveAt: 1, projectName: 'Project', fidelity: 'exact-native-id' as const,
  availability: 'available' as const
};

const snapshot = (overrides: Partial<ConversationHistorySnapshot> = {}): ConversationHistorySnapshot => ({
  snapshotId: 'snapshot', status: 'ready', rows: [row], coverage: [], hasNextPage: false, ...overrides
});

describe('historySnapshotForDisplay', () => {
  it('keeps rows clickable while refresh starts and readers are still provisional', () => {
    const current = snapshot();
    const provisional = snapshot({ snapshotId: 'refresh', status: 'provisional', rows: [] });
    expect(historySnapshotForDisplay(current, provisional, true)).toBe(current);
  });

  it('replaces prior rows as soon as refreshed results arrive', () => {
    const current = snapshot();
    const refreshed = snapshot({ snapshotId: 'refresh', rows: [{ ...row, historyId: 'new-row', title: 'New conversation' }] });
    expect(historySnapshotForDisplay(current, refreshed, true)).toBe(refreshed);
  });

  it('keeps prior rows when refresh completes empty', () => {
    const current = snapshot();
    const empty = snapshot({ snapshotId: 'refresh', status: 'ready', rows: [] });
    expect(historySnapshotForDisplay(current, empty, true)).toBe(current);
  });

  it('shows an empty initial load because no previous choices exist', () => {
    const empty = snapshot({ rows: [] });
    expect(historySnapshotForDisplay(snapshot({ rows: [] }), empty, false)).toBe(empty);
  });
});

describe('recent conversation list layout', () => {
  it('scrolls rows inside the list so the section header stays put', () => {
    const css = readFileSync(new URL('../../styles/global.css', import.meta.url), 'utf8');
    const start = css.indexOf('.conversation-history-list {');
    expect(start).toBeGreaterThan(-1);
    const block = css.slice(start, css.indexOf('}', start));
    expect(block).toContain('overflow-y: auto');
    expect(block).toContain('max-height: min(240px, 40vh)');
  });
});
