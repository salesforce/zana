import { expect, it, vi } from 'vitest';
import { createFakePluginHost } from '@zana-ai/zcc-plugin-sdk/testing';
import plugin from './server.js';
import { guides, searchGuides } from './help.js';
import { noAssistant } from './assistant.js';

const models = ['Sonnet', 'Haiku'].map((name) => ({
  providerId: 'claude-code', modelId: name.toLowerCase(), providerLabel: 'Claude Code', modelLabel: name
}));

function fixture() {
  const { zcc, harness } = createFakePluginHost();
  const complete = vi.fn().mockResolvedValue({ text: JSON.stringify({ answer: 'Open Configuration.', sourceIds: ['slack', 'invented'] }) });
  const localModels = vi.fn().mockResolvedValue({ models, defaultModel: models[0] });
  Object.assign(zcc.sdk.assistant, { complete, localModels });
  plugin(zcc);
  return { zcc, harness, complete, localModels };
}

it('finds the three offline examples and troubleshooting symptoms without inventing an unrelated match', () => {
  for (const guide of guides) expect(searchGuides(guide.example)[0]?.id).toBe(guide.id);
  expect(searchGuides('OAuth callback failed')[0]?.id).toBe('slack');
  expect(searchGuides('Timezone and cron')[0]?.id).toBe('scheduler');
  expect(searchGuides('How far away is Jupiter?')).toEqual([]);
});

it('runs on an older host with offline help', async () => {
  const { zcc, harness } = createFakePluginHost();
  plugin(zcc);
  expect(await harness.callRpc('status')).toEqual(noAssistant);
  expect(await harness.callRpc('answer', { question: 'Slack?' })).toBeNull();
});

it('persists only the selected provider-model pair and preserves it while unavailable', async () => {
  const { zcc, harness, localModels } = fixture();
  const selection = { providerId: 'claude-code', modelId: 'haiku' };
  await expect(harness.callRpc('selectModel', {})).rejects.toThrow('Invalid');
  await expect(harness.callRpc('selectModel', { ...selection, modelId: 'unknown' })).rejects.toThrow('no longer available');
  await harness.callRpc('selectModel', selection);
  expect(await zcc.storage.kv.get('model-selection')).toEqual(selection);
  localModels.mockResolvedValueOnce({ models: [], defaultModel: null });
  expect(await harness.callRpc('status')).toEqual({ models: [], defaultModel: null, selection });
  await harness.callRpc('selectModel', null);
  expect(await zcc.storage.kv.get('model-selection')).toBeUndefined();
});

it('sends a bounded question, recent turns and local excerpts, returning only supplied citations', async () => {
  const { harness, complete } = fixture();
  const question = 'Where is that setting?';
  const previous = { question: 'How do I connect Slack?', answer: 'Open Plugins.', sourceIds: ['slack', 'injected'] };
  const selection = { providerId: 'claude-code', modelId: 'haiku' };
  expect(await harness.callRpc('answer', { question, turns: Array(5).fill(previous), selection }))
    .toEqual({ question, answer: 'Open Configuration.', sourceIds: ['slack'] });
  const request = complete.mock.calls[0][0];
  expect(request.desktop).toEqual({ model: selection });
  const prompt = JSON.parse(request.prompt);
  expect(prompt.recentTurns).toHaveLength(3);
  expect(prompt.guides.map((guide: { id: string }) => guide.id)).toEqual(['slack']);
  expect(prompt.guides[0].sections[0].steps[0]).toContain('Zana for Slack');
  await expect(harness.callRpc('answer', { question: 'x'.repeat(2001) })).rejects.toThrow('at most 2,000');
  const result = await harness.callRpc('answer', { question: 'Where is Jupiter?' });
  expect(result).toMatchObject({ sourceIds: [], answer: expect.stringContaining('guides don’t cover') });
  expect(complete).toHaveBeenCalledOnce();
});
