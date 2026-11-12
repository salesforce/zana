import { describe, expect, it, vi } from 'vitest';
import { withPluginPageContext } from './plugin-page-context.js';

const target = { projectId: 'project', expectedPluginId: 'notes' };
const page = { pluginId: 'notes', panel: 'main', projectId: 'project', view: 'folder/a file.md',
  page: { title: 'Architecture', resourceId: 'doc-a', path: 'api.md', mention: { providerId: 'doc', itemId: 'doc-a' } } };
function setup() {
  return { status: vi.fn(() => 'running'), get: vi.fn(() => ({ name: 'Notes' })),
    resolveMention: vi.fn(async () => ({ ok: true, context: 'Canonical doc A. Read with note_read id=doc-a.' })) } as any;
}

describe('page context at submission', () => {
  it('leaves ordinary threads untouched', async () => {
    const input = [{ type: 'text', text: 'Hello' }];
    expect(await withPluginPageContext(undefined, input, undefined, target)).toBe(input);
  });

  it('appends a small agent-only reference without reading content or changing user input', async () => {
    const plugins = setup();
    const input = [{ type: 'text', text: 'Explain this', mentions: [] }];
    const result = await withPluginPageContext(plugins, input, page, target) as any[];
    expect(input).toHaveLength(1);
    expect(result[0]).toEqual(input[0]);
    expect(result[1]).toMatchObject({ type: 'text', visibility: 'agent-only', mentions: [] });
    expect(result[1].text).toContain('"plugin":"Notes"');
    expect(result[1].text).toContain('"path":"api.md"');
    expect(result[1].text).toContain('"read":{"tool":"page_context_read","arguments":{"pluginId":"notes","providerId":"doc","itemId":"doc-a"}}');
    expect(result[1].text).not.toContain('Canonical doc A.');
    expect(result[1].text.length).toBeLessThan(800);
    expect(plugins.resolveMention).not.toHaveBeenCalled();
  });

  it('supports future plugins without a resource publisher or mention provider', async () => {
    const plugins = setup(); plugins.get.mockReturnValue(undefined);
    const result = await withPluginPageContext(plugins, 'Hi', { pluginId: 'notes', panel: 'main' }, { projectId: 'project' }) as any[];
    expect(result[0]).toEqual({ type: 'text', text: 'Hi', mentions: [] });
    expect(result[1].text).toContain('"plugin":"notes"');
    expect(plugins.resolveMention).not.toHaveBeenCalled();
  });

  it.each([undefined, null, {}, [], '', '  ', [{ type: 'text', text: '', mentions: [] }], [{ type: 'invalid' }]])('does not turn empty or malformed user input into an ambient context prompt: %j', async input => {
    const plugins = setup();
    await expect(withPluginPageContext(plugins, input, page, target)).rejects.toMatchObject({ status: 400, code: 'invalid-input' });
    expect(plugins.resolveMention).not.toHaveBeenCalled();
  });

  it('accepts attachments without text and existing dotted provider identifiers', async () => {
    const plugins = setup();
    const result = await withPluginPageContext(plugins, [{ type: 'localImage', path: '/tmp/image.png' }], { ...page,
      page: { ...page.page, mention: { providerId: 'docs.v2', itemId: 'doc-a' } } }, target) as any[];
    expect(result[0]).toEqual({ type: 'localImage', path: '/tmp/image.png' });
    expect(result[1].text).toContain('"providerId":"docs.v2"');
    expect(plugins.resolveMention).not.toHaveBeenCalled();
  });

  it('refreshes follow-up context and clears selected resources on list/settings pages', async () => {
    const plugins = setup();
    const input = [{ type: 'text', text: 'What is here?', mentions: [] }];
    const first = await withPluginPageContext(plugins, input, page, target) as any[];
    const next = await withPluginPageContext(plugins, input, { pluginId: 'notes', panel: 'main', page: { title: 'Settings' } }, target) as any[];
    expect(first[1].text).toContain('doc-a');
    expect(next[1].text).toContain('Settings');
    expect(next[1].text).not.toContain('doc-a');
    expect(next).toHaveLength(2);
  });

  it('freezes the retrieval reference so navigation cannot retarget queued context', async () => {
    const plugins = setup();
    const current = structuredClone(page);
    const pending = withPluginPageContext(plugins, 'Queued on A', current, target);
    current.page.resourceId = 'doc-b'; current.page.title = 'Document B';
    current.page.mention.itemId = 'doc-b';
    const queued = JSON.parse(JSON.stringify(await pending)) as any[];
    expect(queued[1].text).toContain('doc-a');
    expect(queued[1].text).not.toContain('doc-b');
    expect(queued[1].text).toContain('"itemId":"doc-a"');
    expect(plugins.resolveMention).not.toHaveBeenCalled();
  });

  it.each([null, {}, { ...page, page: { title: 'x'.repeat(161) } }, { ...page, view: 'x'.repeat(4097) },
    { ...page, page: { title: 'Hello\nInjected' } }, { ...page, extra: true },
    { ...page, page: { title: 'Doc', mention: { providerId: 'other:provider', itemId: 'x' } } }])('rejects invalid or oversized context: %j', async raw => {
    await expect(withPluginPageContext(setup(), 'Hi', raw, target)).rejects.toMatchObject({ status: 400 });
  });

  it('accepts long opaque resource identities and spaces without dropping them', async () => {
    const id = 'folder with spaces/'.repeat(150);
    const result = await withPluginPageContext(setup(), 'Hi', { pluginId: 'notes', panel: 'main', page: { title: 'A file', resourceId: id } }, target) as any[];
    expect(result[1].text).toContain(id);
  });

  it.each([undefined, 'stopped'])('rejects an unavailable plugin (%s)', async status => {
    const plugins = setup(); plugins.status.mockReturnValue(status);
    await expect(withPluginPageContext(plugins, 'Hi', page, target)).rejects.toMatchObject({ status: 409 });
  });
  it('rejects a missing host and the reserved origin', async () => {
    await expect(withPluginPageContext(undefined, 'Hi', page, target)).rejects.toMatchObject({ status: 409 });
    await expect(withPluginPageContext(setup(), 'Hi', { ...page, pluginId: 'sdk' }, target)).rejects.toMatchObject({ status: 409 });
  });
  it.each([{ ...target, projectId: 'other' }, { ...target, expectedPluginId: 'other' }])('rejects forged creation ownership %j', async target => {
    const plugins = setup();
    await expect(withPluginPageContext(plugins, 'Hi', page, target)).rejects.toMatchObject({ status: 403 });
    expect(plugins.resolveMention).not.toHaveBeenCalled();
  });
  it('accepts the current page of a different running plugin for an existing conversation', async () => {
    const plugins = setup();
    const result = await withPluginPageContext(plugins, 'Explain this', { ...page, pluginId: 'other-plugin' }, { projectId: 'project' }) as any[];
    expect(result[1].text).toContain('"pluginId":"other-plugin"');
    expect(result[1].text).toContain('"arguments":{"pluginId":"other-plugin","providerId":"doc","itemId":"doc-a"}');
    expect(plugins.resolveMention).not.toHaveBeenCalled();
  });
  it('does not block sends on unavailable content or invoke a slow resolver', async () => {
    const plugins = setup(); plugins.resolveMention.mockImplementation(() => new Promise(() => {}));
    const result = await withPluginPageContext(plugins, 'Hi', page, target) as any[];
    expect(result[1].text).toContain('page_context_read');
    expect(plugins.resolveMention).not.toHaveBeenCalled();
  });
});
