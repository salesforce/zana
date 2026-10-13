import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { createFakePluginHost } from '@zana-ai/zcc-plugin-sdk/testing';
import { collectTestPluginApp } from '@zana-ai/zcc-plugin-sdk/testing/app';
import { derivePluginId, readPluginManifest } from '@zana-ai/zcc-domain';
import { discoverPluginSkillNames } from '@zana-ai/zcc-server/plugins/plugin-skills';
import { invokePluginAgentTool, toDynamicTool } from '@zana-ai/zcc-server/plugins/plugin-agent-tools';
import { ASK_USER_QUESTION_RENDERER_ID } from '@zana-ai/zcc-plugin-interaction-contracts';
import plugin from '../server.mjs';
import app from '../app.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('ask-user-question plugin', () => {
  it('derives a stable id and ships a skill', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { name: string };
    expect(derivePluginId(pkg.name)).toBe('ask-user-question');
    const manifest = readPluginManifest(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')));
    expect(discoverPluginSkillNames(root, manifest.skillsRootPaths)).toEqual(['ask-user-question']);
    expect(readFileSync(join(root, 'skills/ask-user-question/SKILL.md'), 'utf8')).toContain(
      'pendingInteraction'
    );
  });

  it('reaches providers with its schema and normalizes a Pi call through the host tool path', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'ask-user-question' });
    const requestInput = vi.spyOn(zcc.ui, 'requestInput').mockResolvedValue({
      outcome: 'submitted',
      value: { answers: [{ question: 'Which option should I pick?', selected: ['B'], freeText: '' }] }
    });
    await plugin(zcc);
    const sources = [{ pluginId: 'ask-user-question', tools: harness.agentTools }];
    const ctx = { threadId: 'thr-1', projectId: 'proj-1', signal: new AbortController().signal };

    const advertised = toDynamicTool(harness.agentTools[0]!).inputSchema as { required?: string[] };
    expect(advertised.required).toEqual(['questions']);

    // The exact arguments from the Pi thread that opened an empty card.
    const answered = await invokePluginAgentTool(sources, 'ask_user_question', {
      questions: '[{"question":"Which option should I pick?","options":["A","B","C"]}]'
    }, ctx);
    expect(requestInput.mock.calls[0]![0].payload).toEqual({
      questions: [{ question: 'Which option should I pick?', options: [{ label: 'A' }, { label: 'B' }, { label: 'C' }] }]
    });
    expect(answered.success).toBe(true);
    expect(answered.contentItems[0]).toMatchObject({ type: 'inputText', text: expect.stringContaining('"selected":["B"]') });

    const rejected = await invokePluginAgentTool(sources, 'ask_user_question', { questions: [] }, ctx);
    expect(rejected.success).toBe(false);
    expect(rejected.contentItems[0]).toMatchObject({
      type: 'inputText',
      text: expect.stringContaining('Tool "ask_user_question" failed: ask_user_question needs')
    });
    expect(requestInput).toHaveBeenCalledTimes(1);
  });

  it('registers ask_user_question and a matching pendingInteraction', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'ask-user-question' });
    await plugin(zcc);
    expect(harness.agentTools[0]?.name).toBe('ask_user_question');
    const set = collectTestPluginApp(app, 'ask-user-question');
    expect(set.pendingInteractions[0]?.id).toBe(ASK_USER_QUESTION_RENDERER_ID);
  });
});
