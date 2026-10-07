import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createFakePluginHost, makeThreadResponse } from '@zana-ai/zcc-plugin-sdk/testing';
import plugin from '../server.js';
import { createTestDatabase } from './server/test-db.js';
import { TOOL_NAMES } from './server/tools.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function load(title = 'Architect') {
  const host = createFakePluginHost({
    pluginId: 'design-docs',
    database: createTestDatabase(),
    getThread: async ({ threadId }) => ({ ...makeThreadResponse({ id: threadId }), title })
  });
  plugin(host.zcc);
  return host.harness;
}

function textOf(result: unknown): string {
  if (typeof result === 'string') return result;
  const parts = (result as { content: Array<{ type: string; text?: string }> }).content;
  return parts.map((part) => part.text ?? '').join('\n');
}

function docIdIn(text: string): string {
  const match = text.match(/dd_[a-z0-9]+/i);
  if (!match) throw new Error(`no doc id in: ${text}`);
  return match[0];
}

describe('design-docs plugin contract', () => {
  it('declares the manifest the host loads', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    expect(pkg.name).toBe('@zcc-ext/design-docs');
    expect(pkg.zcc).toMatchObject({ server: './server.mjs', app: './app.js', skills: ['skills'], branding: { icon: 'DraftingCompass' } });
  });

  it('registers tools, instructions, mentions, CLI and RPC', async () => {
    const harness = load();
    expect(harness.agentTools.map((tool) => tool.name)).toEqual([...TOOL_NAMES]);
    expect(harness.extraInstructionProviders).toHaveLength(1);
    expect(harness.mentionProviders.map((provider) => provider.id)).toEqual(['design-doc']);
    expect(harness.cli?.name).toBe('design-docs');
    expect([...harness.rpc.keys()]).toContain('askAgent');
    expect(harness.events.map((event) => event.name)).toEqual(['thread.idle', 'thread.deleted']);
    await harness.dispose();
  });

  it('lets an agent create, read, edit and review a doc the UI then sees live', async () => {
    const harness = load();
    const ctx = { threadId: 'thread-a', projectId: 'project-1' };

    const id = docIdIn(textOf(await harness.callAgentTool('design_doc_create', { title: 'Event bus', template: 'technical' }, ctx)));
    const read = textOf(await harness.callAgentTool('design_doc_read', { doc: id }, ctx));
    expect(read).toContain('README.md [entry]');
    expect(read).toContain('created by agent "Architect"');

    const write = textOf(
      await harness.callAgentTool(
        'design_doc_write',
        { doc: id, path: 'README.md', edits: [{ oldText: '# Event bus', newText: '# Event bus (v1)' }], baseRevision: 1 },
        ctx
      )
    );
    expect(write).toMatch(/revision 2/);
    await harness.callAgentTool('design_doc_comment', { doc: id, body: 'Define ordering guarantees', path: 'README.md' }, ctx);
    await harness.callAgentTool('design_doc_update', { doc: id, status: 'review' }, ctx);
    expect(textOf(await harness.callAgentTool('design_doc_list', {}, ctx))).toContain('In review · 2 files · 1 open comment');

    expect(harness.published.filter((signal) => signal.event === 'changed')).toHaveLength(4);
    expect(harness.published[0]!.payload).toEqual({ docId: id });

    const detail = (await harness.callRpc('get', { doc: id })) as { status: string; threads: Array<{ title: string; role: string }> };
    expect(detail.status).toBe('review');
    expect(detail.threads).toEqual([expect.objectContaining({ title: 'Architect', role: 'author' })]);

    const instructions = harness.extraInstructionProviders[0]!({ threadId: 'thread-b', projectId: 'project-1' });
    expect(instructions).toContain(`${id} "Event bus"`);
    expect((await harness.runCli(['read', id, 'README.md'], { projectId: 'project-1' })).stdout).toContain('# Event bus (v1)');

    // A conflicting write surfaces as a failed tool call the agent can recover from.
    await expect(
      harness.callAgentTool('design_doc_write', { doc: id, path: 'README.md', content: 'stale', baseRevision: 1 }, ctx)
    ).rejects.toThrow(/changed since revision 1/);
    await harness.dispose();
  });

  it('keeps linked threads current from lifecycle events', async () => {
    const harness = load('Writer');
    const id = docIdIn(
      textOf(await harness.callAgentTool('design_doc_create', { title: 'Doc', template: 'blank' }, { threadId: 'thread-x' }))
    );
    const before = harness.published.length;

    await harness.emitThreadEvent('thread.idle', { thread: { ...makeThreadResponse({ id: 'thread-x' }), title: 'Writer (done)' } });
    let detail = (await harness.callRpc('get', { doc: id })) as { threads: Array<{ title: string }> };
    expect(detail.threads[0]!.title).toBe('Writer (done)');

    await harness.emitThreadEvent('thread.deleted', { thread: makeThreadResponse({ id: 'thread-x' }) });
    detail = (await harness.callRpc('get', { doc: id })) as { threads: Array<{ title: string }> };
    expect(detail.threads).toEqual([]);
    expect(harness.published.length).toBe(before + 2);
    await harness.dispose();
  });
});
