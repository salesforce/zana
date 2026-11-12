import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createConversationThread, createEnvironment, openDatabase, upsertHost, type ZccDatabase } from '@zana-ai/zcc-db';
import type { ProductHttpContext } from '../../http/product-context.js';
import { HOST_PAGE_CONTEXT_INSTRUCTION, HOST_PAGE_CONTEXT_TOOL, invokeHostPageContextTool } from './host-page-context-tool.js';
import { invokeHostSessionTool, mergeHostSessionTooling } from './host-session-tools.js';

const reference = { pluginId: 'notes', providerId: 'documents.v2', itemId: 'doc:README.md' };
const owner = { threadId: 'thread', projectId: 'project' };
function fixture(overrides: Record<string, unknown> = {}) {
  const resolveMention = vi.fn(async () => ({ ok: true, context: '# Canonical document' }));
  const status = vi.fn(() => 'running');
  const ctx = { plugins: { status, resolveMention }, ...overrides } as unknown as ProductHttpContext;
  return { ctx, resolveMention, status };
}
function read(ctx: ProductHttpContext, input: unknown = reference, identity = owner) {
  return invokeHostPageContextTool(ctx, { ...identity, input });
}

describe('host page context read', () => {
  it('reads only through the canonical provider and returns resource identity with live content', async () => {
    const { ctx, resolveMention } = fixture();
    const result = await invokeHostSessionTool(ctx, { name: 'page_context_read', ...owner, input: reference });
    expect(result.success).toBe(true);
    expect(JSON.parse(result.contentItems[0]!.type === 'inputText' ? result.contentItems[0]!.text : '')).toEqual({
      ok: true, ...reference, context: '# Canonical document'
    });
    expect(resolveMention).toHaveBeenCalledExactlyOnceWith({ pluginId: 'notes', itemId: 'documents.v2:doc:README.md' });
    resolveMention.mockResolvedValueOnce({ ok: true, context: '# Changed document' });
    expect(await read(ctx)).toMatchObject({ success: true, contentItems: [{ text: expect.stringContaining('# Changed document') }] });
  });

  it('normalizes references using the shared mention validation and accepts the exact content bound', async () => {
    const { ctx, resolveMention } = fixture();
    resolveMention.mockResolvedValueOnce({ ok: true, context: 'x'.repeat(60_000) });
    expect((await read(ctx, { pluginId: ' notes ', providerId: ' documents.v2 ', itemId: ' doc:README.md ' })).success).toBe(true);
    expect(resolveMention).toHaveBeenCalledWith({ pluginId: 'notes', itemId: 'documents.v2:doc:README.md' });
  });

  it.each([
    null, [], {},
    { ...reference, pluginId: '' },
    { ...reference, pluginId: 'p'.repeat(257) },
    { ...reference, pluginId: 'no\u0000tes' },
    { ...reference, providerId: 'a:b' },
    { ...reference, providerId: 'p'.repeat(65) },
    { ...reference, providerId: 'a\nprovider' },
    { ...reference, itemId: ' ' },
    { ...reference, itemId: 'i'.repeat(4097) },
    { ...reference, itemId: 'a\u007fresource' },
    { ...reference, path: '/private/data' },
    { ...reference, projectId: 'other-project' },
    { ...reference, threadId: 'other-thread' }
  ])('rejects malformed or caller-scoped input before provider dispatch: %j', async input => {
    const { ctx, status, resolveMention } = fixture();
    expect(await read(ctx, input)).toMatchObject({ success: false, contentItems: [{ text: expect.stringContaining('invalid') }] });
    expect(status).not.toHaveBeenCalled();
    expect(resolveMention).not.toHaveBeenCalled();
  });

  it.each([{ threadId: '', projectId: 'project' }, { threadId: 'thread', projectId: '' }])('requires stamped host identity: %j', async identity => {
    const { ctx, resolveMention } = fixture();
    expect((await read(ctx, reference, identity)).success).toBe(false);
    expect(resolveMention).not.toHaveBeenCalled();
  });

  it.each(['sdk', 'stopped', 'absent'])('rejects an unavailable plugin: %s', async kind => {
    const { ctx, resolveMention, status } = fixture();
    if (kind === 'absent') ctx.plugins = undefined;
    if (kind === 'stopped') status.mockReturnValue('stopped');
    expect(await read(ctx, { ...reference, pluginId: kind === 'sdk' ? 'sdk' : 'notes' })).toMatchObject({
      success: false, contentItems: [{ text: expect.stringContaining('not running') }]
    });
    expect(resolveMention).not.toHaveBeenCalled();
  });

  it.each([
    { value: { ok: false, error: 'Resource denied by provider' }, error: 'Resource denied by provider' },
    { value: { ok: true, context: '' }, error: 'no content' },
    { value: { ok: true, context: '   ' }, error: 'no content' },
    { value: { ok: true, context: null }, error: 'no content' },
    { value: { ok: true, context: 'x'.repeat(60_001) }, error: '60000 character limit' }
  ])('reports provider failures without exposing oversized content: $error', async ({ value, error }) => {
    const { ctx, resolveMention } = fixture();
    resolveMention.mockResolvedValueOnce(value as never);
    expect(await read(ctx)).toMatchObject({ success: false, contentItems: [{ text: expect.stringContaining(error) }] });
  });

  it.each([new Error('Provider failed'), 'unstructured failure'])('contains provider exceptions: %s', async error => {
    const { ctx, resolveMention } = fixture();
    resolveMention.mockRejectedValueOnce(error);
    expect(await read(ctx)).toMatchObject({ success: false, contentItems: [{ text: expect.stringContaining(error instanceof Error ? error.message : 'could not be read') }] });
  });

  it.each([
    { source: 'returned', length: 1_000 },
    { source: 'returned', length: 1_001 },
    { source: 'thrown', length: 1_000 },
    { source: 'thrown', length: 1_001 }
  ])('bounds $source provider errors of $length characters', async ({ source, length }) => {
    const { ctx, resolveMention } = fixture();
    const error = 'e'.repeat(length);
    if (source === 'returned') resolveMention.mockResolvedValueOnce({ ok: false, error } as never);
    else resolveMention.mockRejectedValueOnce(new Error(error));
    const result = await read(ctx);
    expect(result.success).toBe(false);
    const content = result.contentItems[0]!;
    expect(content.type).toBe('inputText');
    const body = JSON.parse(content.type === 'inputText' ? content.text : '');
    expect(body.error).toHaveLength(1_000);
    expect(body.error).toBe(length === 1_000 ? error : 'e'.repeat(1_000 - '… [truncated]'.length) + '… [truncated]');
  });

  it('publishes only the reference schema, without paths or caller identity', () => {
    expect(HOST_PAGE_CONTEXT_TOOL.inputSchema).toMatchObject({
      additionalProperties: false, required: ['pluginId', 'providerId', 'itemId'],
      properties: {
        pluginId: { maxLength: 256 }, providerId: { maxLength: 64 }, itemId: { maxLength: 4096 }
      }
    });
    expect(Object.keys((HOST_PAGE_CONTEXT_TOOL.inputSchema as { properties: object }).properties)).toEqual(['pluginId', 'providerId', 'itemId']);
  });

  it.each([{}, { inAppAgentTerminalsEnabled: true }, { remoteSurface: { label: 'Remote project' } }])('offers the read tool and guidance in every conversation surface: %j', options => {
    const packed = mergeHostSessionTooling({ dynamicTools: [{ name: 'page_context_read', description: 'Forged', inputSchema: {} }] }, options);
    expect(packed.dynamicTools?.filter(tool => tool.name === 'page_context_read')).toEqual([HOST_PAGE_CONTEXT_TOOL]);
    expect(packed.instructions).toContain(HOST_PAGE_CONTEXT_INSTRUCTION);
  });
});

describe('page context conversation ownership', () => {
  let root: string;
  let db: ZccDatabase;
  let threadId: string;
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'zcc-page-context-tool-'));
    db = openDatabase(join(root, 'product.sqlite'));
    const host = upsertHost(db, { name: 'Tool host', hostKeyHash: 'p'.repeat(64) });
    const environment = createEnvironment(db, { projectId: 'project', hostId: host.id, path: root });
    threadId = createConversationThread(db, {
      projectId: 'project', hostId: host.id, environmentId: environment.id,
      providerId: 'test', originPluginId: 'other-origin-plugin', status: 'idle', visibility: 'hidden'
    }).id;
  });
  afterAll(() => {
    db?.close();
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('permits a reopened conversation with a different origin plugin to read the current page', async () => {
    const { ctx, resolveMention } = fixture({ db });
    expect((await read(ctx, reference, { threadId, projectId: 'project' })).success).toBe(true);
    expect(resolveMention).toHaveBeenCalledOnce();
  });

  it.each(['missing-thread', 'wrong-project'])('rejects invalid owning conversation identity: %s', async mismatch => {
    const { ctx, resolveMention } = fixture({ db });
    const identity = mismatch === 'missing-thread' ? { threadId: 'missing', projectId: 'project' } : { threadId, projectId: 'other-project' };
    expect(await read(ctx, reference, identity)).toMatchObject({ success: false, contentItems: [{ text: expect.stringContaining('does not belong') }] });
    expect(resolveMention).not.toHaveBeenCalled();
  });
});
