// @vitest-environment happy-dom
// @vitest-environment-options { "settings": { "handleDisabledFileLoadingAsSuccess": true } }
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { UI_USER } from '../server/rpc.js';
import { DocView } from './DocView.js';
import { createHarness, type Harness } from './test-harness.js';

function scenario() {
  const harness = createHarness();
  const target = harness.store.create({ title: 'Target Spec', projectId: 'p1', files: [{ path: 'README.md', content: 'entry' }, { path: 'api.md', content: 'api' }] }, UI_USER);
  const other = harness.store.create({ title: 'Secret Spec', projectId: 'p2', files: [{ path: 'README.md', content: 'x' }] }, UI_USER);
  const source = harness.store.create({
    title: 'Source',
    projectId: 'p1',
    files: [{
      path: 'README.md',
      content: [
        `[Slug](doc://${target.slug}/api.md#a)`, `[Id](doc://${target.id}/api.md)`, `[Entry](doc://${target.slug})`, `[Short](doc:${target.slug}/api.md)`,
        '[Nope](doc://no-such-doc/a.md)', `[Gone](doc://${target.slug}/gone.md)`, `[Secret](doc://${other.slug}/README.md)`, '[Bad](doc://x/../y.md)',
        '[Local](api.md)', '[Ext](https://example.com)'
      ].join('\n\n')
    }, { path: 'api.md', content: 'local api' }]
  }, UI_USER);
  return { harness, target, source };
}

function open(harness: Harness, docId: string, opened: string[]) {
  harness.render(<DocView docId={docId} path={null} layout="workbench" contextProjectId={null} onDeleted={() => {}} onOpenPath={(path) => { if (path) opened.push(path); }} />);
}

async function readme() {
  await waitFor(() => expect(document.querySelector('section[aria-label="README.md"]')).not.toBeNull());
  return document.querySelector<HTMLElement>('section[aria-label="README.md"]')!;
}

describe('cross-doc links in a preview', () => {
  it('opens another doc by slug, id, entry file and shorthand through the navigation panel', async () => {
    const { harness, target, source } = scenario();
    open(harness, source.id, []);
    const pane = await readme();
    for (const [label, path] of [['Slug', 'api.md'], ['Id', 'api.md'], ['Entry', 'README.md'], ['Short', 'api.md']] as const) {
      fireEvent.click(within(pane).getByText(label));
      await waitFor(() => expect(harness.navigateCalls.some((call) => JSON.stringify(call).includes(`${target.id}/${path}`))).toBe(true));
    }
    expect(harness.rpcCalls.filter((call) => call.method === 'resolveCrossDocLink')).toHaveLength(4);
  });
  it('toasts a distinct message per failure and never navigates', async () => {
    const { harness, source } = scenario();
    open(harness, source.id, []);
    const pane = await readme();
    fireEvent.click(within(pane).getByText('Nope'));
    await waitFor(() => expect(harness.toasts.map((t) => t.message)).toContain('That design doc does not exist (or was removed)'));
    fireEvent.click(within(pane).getByText('Gone'));
    await waitFor(() => expect(harness.toasts.map((t) => t.message)).toContain('That file does not exist in the linked design doc'));
    fireEvent.click(within(pane).getByText('Secret'));
    await waitFor(() => expect(harness.toasts.map((t) => t.message)).toContain('You cannot open that design doc from here'));
    fireEvent.click(within(pane).getByText('Bad'));
    expect(harness.toasts.map((t) => t.message)).toContain('This doc link is not valid');
    expect(harness.navigateCalls.filter((call) => JSON.stringify(call).includes('subPath'))).toEqual([]);
  });
  it('toasts when the resolve call itself fails', async () => {
    const { harness, source } = scenario();
    harness.fail('resolveCrossDocLink', 'boom');
    open(harness, source.id, []);
    fireEvent.click(within(await readme()).getByText('Slug'));
    await waitFor(() => expect(harness.toasts.map((t) => t.message)).toContain('That design doc does not exist (or was removed)'));
  });
  it('keeps same-doc and external links unchanged', async () => {
    const { harness, source } = scenario();
    const opened: string[] = [];
    open(harness, source.id, opened);
    const pane = await readme();
    fireEvent.click(within(pane).getByText('Local'));
    expect(opened).toEqual(['api.md']);
    fireEvent.click(within(pane).getByText('Ext'));
    expect(harness.rpcCalls.some((call) => call.method === 'resolveCrossDocLink')).toBe(false);
  });
  it('opens a doc:// link to the same doc as an in-doc path', async () => {
    const { harness } = scenario();
    const source = harness.store.create({ title: 'Selfy', projectId: 'p1', files: [{ path: 'README.md', content: '[Self](doc://selfy/api.md)' }, { path: 'api.md', content: 'x' }] }, UI_USER);
    const opened: string[] = [];
    open(harness, source.id, opened);
    fireEvent.click(within(await readme()).getByText('Self'));
    await waitFor(() => expect(opened).toEqual(['api.md']));
  });
});
