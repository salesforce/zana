import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { nextTurnItemText, queuedMessagePreview, queuedMessageTextFromUnknown } from './queued-message-text.js';
import { canEditConversationMessage, visibleMessageText } from './MessageActionBar.js';
import { quoteForComposer } from '../secondary-panel/SecondaryPanelSelectionActions.js';
import { previousQueuedIdAfterReorder } from './queued-reorder.js';

describe('queued message text', () => {
  it('joins text parts', () => {
    expect(queuedMessageTextFromUnknown({
      content: [{ type: 'text', text: 'hello' }, { type: 'text', text: 'there' }]
    })).toBe('hello\nthere');
    expect(queuedMessageTextFromUnknown({
      input: [{ type: 'text', text: 'queued' }]
    })).toBe('queued');
    expect(queuedMessageTextFromUnknown(null)).toBe('');
    expect(nextTurnItemText({
      payload: JSON.stringify({ kind: 'send', input: [{ type: 'text', text: 'later' }] })
    })).toBe('later');
  });

  it('collapses queued text to a single-line preview', () => {
    expect(queuedMessagePreview('hello\nthere')).toBe('hello there');
    expect(queuedMessagePreview('  a   b  ')).toBe('a b');
    expect(queuedMessagePreview('')).toBe('');
  });
});

describe('message overflow', () => {
  it('clips long messages until expanded', () => {
    const long = 'a'.repeat(2500);
    expect(visibleMessageText(long, false).endsWith('…')).toBe(true);
    expect(visibleMessageText(long, true)).toBe(long);
    expect(visibleMessageText('short', false)).toBe('short');
  });
});

describe('message actions helpers', () => {
  it('quotes selected text for the composer', () => {
    expect(quoteForComposer('hello\nworld')).toBe('> hello\n> world');
  });

  it('computes the previous queued id after a drag reorder', () => {
    expect(previousQueuedIdAfterReorder(['a', 'b', 'c'], 'c', 'a')).toBe(null);
    expect(previousQueuedIdAfterReorder(['a', 'b', 'c'], 'a', 'c')).toBe('c');
    expect(previousQueuedIdAfterReorder(['a', 'b', 'c'], 'a', 'a')).toBeUndefined();
  });

  it('renders queued sends as translucent composer ghosts with a hover stop', () => {
    const source = readFileSync(new URL('./ComposerStackCards.tsx', import.meta.url), 'utf8');
    expect(source).toContain('thread-queued-ghosts');
    expect(source).toContain('thread-queued-ghost');
    expect(source).toContain('thread-queued-ghost-body');
    expect(source).toContain('thread-queued-ghost-stop');
    expect(source).toContain('thread-queued-item-text');
    expect(source).toContain('queuedMessagePreview');
    expect(source).toContain('deleteNextTurn');
    expect(source).toContain('<Square size={14} fill="currentColor"');
    expect(source).toContain('thread-queued-flush');
    expect(source).toContain('thread-queued-send-now');
    expect(source).toContain('flushNextTurn');
    expect(source).toContain('thread-queued-card-paused');
    expect(source).toContain('.catch');
    expect(source).not.toContain('disabled={flushing}');
    expect(source).not.toContain('thread-queued-messages-card');
    const css = readFileSync(new URL('../../../styles/global.css', import.meta.url), 'utf8');
    const ghost = css.slice(
      css.indexOf('.thread-queued-ghost {'),
      css.indexOf('.thread-queued-ghost-stop {')
    );
    expect(ghost).toContain('opacity: 0.55;');
    expect(ghost).toContain('border-radius: 12px;');
    expect(ghost).toContain('flex-direction: row;');
    expect(ghost).toContain('align-items: center;');
    const stop = css.slice(
      css.indexOf('.thread-queued-ghost-stop {'),
      css.indexOf('.thread-queued-ghost-stop:hover:not(:disabled) {')
    );
    expect(stop).toContain('opacity: 0;');
    expect(stop).toContain('flex: 0 0 auto;');
    expect(stop).not.toContain('position: absolute;');
    expect(stop).not.toContain('top: 6px;');
    expect(css).toContain('.thread-queued-ghost:hover .thread-queued-ghost-stop');
    expect(css).toContain('.thread-queued-item-text {');
    expect(css).toContain('text-overflow: ellipsis;');
    expect(css).not.toContain('.thread-composer-dock .thread-queued-messages-card {');
    expect(css).not.toContain('.thread-next-turn-paused {');
    expect(css).not.toContain('.thread-next-turn-send-now {');
  });

  it('allows editing accepted idle user messages only', () => {
    const request = { kind: 'message', status: 'accepted' };
    expect(canEditConversationMessage({ role: 'user', turnRequest: request }, true)).toBe(true);
    expect(canEditConversationMessage({ role: 'user', turnRequest: request }, false)).toBe(false);
    expect(canEditConversationMessage({ role: 'assistant', turnRequest: request }, true)).toBe(false);
  });
});

describe('prompt context banner', () => {
  it('does not show dirty-file count or Review; workspace banner owns that', () => {
    const source = readFileSync(new URL('./ComposerStackCards.tsx', import.meta.url), 'utf8');
    const bannerStart = source.indexOf('export function PromptContextBanner');
    const bannerEnd = source.indexOf('export function', bannerStart + 1);
    const banner = source.slice(bannerStart, bannerEnd > bannerStart ? bannerEnd : undefined);
    expect(banner).toContain('thread-prompt-context');
    expect(banner).toContain('thread-prompt-context-pr');
    expect(banner).not.toContain('uncommitted');
    expect(banner).not.toContain('onReview');
    expect(banner).not.toContain('thread-prompt-context-review');
    expect(banner).not.toContain('dirtyCount');
    expect(banner).not.toContain('Review');

    const detail = readFileSync(new URL('../../../views/threads/ThreadDetailView.tsx', import.meta.url), 'utf8');
    expect(detail).toContain('<ThreadWorkspaceBanner');
    expect(detail).not.toContain('onReview={() => openDiff()}');
    const dockAt = detail.indexOf('className="thread-composer-dock"');
    const bannerAt = detail.indexOf('<ThreadWorkspaceBanner');
    const composerAt = detail.indexOf('<ThreadCommandComposer');
    expect(bannerAt).toBeGreaterThan(dockAt);
    expect(composerAt).toBeGreaterThan(bannerAt);

    const workspace = readFileSync(new URL('../ThreadWorkspaceBanner.tsx', import.meta.url), 'utf8');
    expect(workspace).toContain('thread-workspace-review');
    expect(workspace).toContain('workspaceFileCountLabel');
    expect(workspace).toContain('Review');
  });
});

