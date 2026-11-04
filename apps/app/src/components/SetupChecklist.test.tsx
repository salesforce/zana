import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { SetupChecklistHost } from './SetupChecklist.js';

const fixture = vi.hoisted(() => ({ phase: 'missing' as 'missing' | 'present' }));
vi.mock('../lib/product-client.js', () => ({ product: { deps: {} } }));
vi.mock('../store.js', () => ({
  useUi: (select: (value: { setupOpen: boolean }) => unknown) => select({ setupOpen: true }),
  useSetup: (select: (value: unknown) => unknown) => select({
    status: { busy: false, items: [{ id: 'codex-cli', label: 'Codex CLI', detail: 'Coding agent',
      kind: 'installable', required: false, phase: fixture.phase }] },
    progress: {}
  })
}));
beforeEach(() => { fixture.phase = 'missing'; });

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
