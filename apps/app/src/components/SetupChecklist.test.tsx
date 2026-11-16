import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { SetupChecklistHost } from './SetupChecklist.js';

const fixture = vi.hoisted(() => ({ phase: 'missing' as string, busy: false, empty: false }));
vi.mock('../lib/product-client.js', () => ({ product: { deps: {} } }));
vi.mock('../store.js', () => ({
  useUi: (select: (value: { setupOpen: boolean }) => unknown) => select({ setupOpen: true }),
  useSetup: (select: (value: unknown) => unknown) => select({
    status: { busy: fixture.busy, items: fixture.empty ? [] : [{ id: 'codex-cli', label: 'Codex CLI', detail: 'Coding agent',
      kind: 'installable', required: false, phase: fixture.phase }] },
    progress: {}
  })
}));
beforeEach(() => { fixture.phase = 'missing'; fixture.busy = false; fixture.empty = false; });

it('offers coding-agent setup without requiring the optional Salesforce integration', () => {
  const html = renderToStaticMarkup(<SetupChecklistHost />);
  expect(html).toContain('These CLIs power your coding agents.');
  expect(html).toContain('Codex CLI');
  expect(html).toContain('Install missing');
  expect(html).not.toContain('Salesforce');
  expect(html).not.toContain('SF CLI');
});

it('finishes core setup when the listed coding agents are installed', () => {
  fixture.phase = 'present';
  const html = renderToStaticMarkup(<SetupChecklistHost />);
  expect(html).toContain('All listed CLIs are installed.');
  expect(html).toContain('Done');
  expect(html).not.toContain('Install missing');
});

it('uses the fairy spinner while checking, installing and before the first status arrives', () => {
  fixture.empty = true;
  expect(renderToStaticMarkup(<SetupChecklistHost />)).toMatch(/fairy-spinner setup-row-icon--spin[^>]*>.*Checking your setup/);
  fixture.empty = false;
  fixture.phase = 'checking';
  expect(renderToStaticMarkup(<SetupChecklistHost />)).toContain('aria-label="working"');
  fixture.phase = 'failed';
  fixture.busy = true;
  const busy = renderToStaticMarkup(<SetupChecklistHost />);
  expect(busy).toContain('Installing…');
  expect(busy).toContain('class="fairy-spinner setup-row-icon--spin"');
});
