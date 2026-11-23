import { describe, expect, it } from 'vitest';
import { botSummary } from './tools.js';
import type { Bot } from './model.js';

describe('botSummary', () => {
  it('reports the routine kind, defaulting legacy routines to agent', () => {
    const bot = {
      id: 'scout', name: 'Scout', personality: 'helpful', projectId: 'p',
      routines: [
        { id: 'a', name: 'Digest', cron: '0 9 * * 1-5', prompt: 'go', enabled: true },
        { id: 'b', name: 'Bitcoin', cron: '*/10 * * * *', prompt: '', enabled: false, kind: 'price' }
      ]
    } as unknown as Bot;
    expect(botSummary(bot).routines).toEqual([
      { id: 'a', name: 'Digest', cron: '0 9 * * 1-5', enabled: true, kind: 'agent' },
      { id: 'b', name: 'Bitcoin', cron: '*/10 * * * *', enabled: false, kind: 'price' }
    ]);
  });
});
