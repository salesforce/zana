import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/app.js';

test.use({ launchEnv: { ZCC_FAKE_PROVIDER: '1' }, isolateBundledCatalog: true });

test('thread diagrams stay compact, fit without clipping, and still expand', async ({ app }, testInfo) => {
  const { window, home } = app;
  await window.setViewportSize({ width: 1500, height: 1000 });
  const root = join(home, 'diagram-project');
  mkdirSync(root);
  const threadId = await window.evaluate(async (root) => {
    const project = await window.cc.projects.add(root);
    if (!project.ok) throw new Error('Project registration failed');
    const response = await fetch('/api/v1/threads', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: project.value.id, providerId: 'fake', input: 'Diagram sizes' })
    });
    if (!response.ok) throw new Error(await response.text());
    return (await response.json()).value.id as string;
  }, root);
  const diagrams = [
    'flowchart TD\n  A[Approve Save] --> B[Preview against real data]',
    'flowchart TD\n  ' + Array.from({ length: 16 }, (_, i) => `N${i}[Step ${i + 1}]`).join(' --> '),
    'flowchart LR\n  ' + Array.from({ length: 8 }, (_, i) => `W${i}[Workflow stage ${i + 1}]`).join(' --> ')
  ];
  await window.route((url) => url.pathname === `/api/v1/threads/${threadId}/timeline`, async (route) => {
    await route.fulfill({ json: {
      rows: [{
        id: 'diagrams', threadId, turnId: 'diagram-turn', sourceSeqStart: 1, sourceSeqEnd: 1,
        startedAt: 1, createdAt: 1, completedAt: 1, kind: 'conversation', role: 'assistant',
        attachments: null, turnRequest: null,
        text: diagrams.map((code) => `\`\`\`mermaid\n${code}\n\`\`\``).join('\n\n')
      }], maxSeq: 1, status: 'idle', activeThinking: null
    } });
  });
  await window.evaluate((id) => {
    history.pushState({}, '', `/threads/${id}`);
    dispatchEvent(new PopStateEvent('popstate'));
  }, threadId);
  const assistant = window.getByTestId('thread-assistant-text');
  const frames = assistant.locator('.inbox-mermaid-frame.is-sized');
  await expect(frames).toHaveCount(3);

  const assertFits = async () => {
    const measurements = await frames.evaluateAll((nodes) => nodes.map((node) => {
      const frame = node.getBoundingClientRect();
      const svg = node.querySelector('svg')!;
      const content = svg.getBBox();
      const matrix = svg.getScreenCTM()!;
      const start = new DOMPoint(content.x, content.y).matrixTransform(matrix);
      const end = new DOMPoint(content.x + content.width, content.y + content.height).matrixTransform(matrix);
      return {
        width: frame.width, height: frame.height, naturalWidth: svg.viewBox.baseVal.width,
        cap: Math.min(480, innerHeight * 0.6),
        fits: start.x >= frame.left - 2 && start.y >= frame.top - 2 && end.x <= frame.right + 2 && end.y <= frame.bottom + 2,
        noHorizontalScroll: node.parentElement!.scrollWidth <= node.parentElement!.clientWidth + 1
      };
    }));
    for (const measurement of measurements) {
      expect(measurement.width).toBeLessThanOrEqual(measurement.naturalWidth + 1);
      expect(measurement.height).toBeLessThanOrEqual(measurement.cap + 1);
      expect(measurement.fits).toBe(true);
      expect(measurement.noHorizontalScroll).toBe(true);
    }
    expect(measurements[0].height).toBeLessThan(300);
    expect(measurements[1].height).toBeCloseTo(measurements[1].cap, 0);
  };
  await assertFits();
  await window.screenshot({ path: testInfo.outputPath('compact-thread-diagrams.png') });
  const tall = assistant.locator('.inbox-mermaid').nth(1);
  await tall.getByRole('button', { name: 'Open diagram in full screen' }).focus();
  await tall.getByRole('button', { name: 'Open diagram in full screen' }).click();
  const expanded = window.getByRole('dialog', { name: 'Diagram', exact: true });
  await expect(expanded).toBeVisible();
  const expandedDiagram = expanded.locator('.mermaid-expanded-diagram');
  const before = await expandedDiagram.getAttribute('style');
  await expanded.getByRole('button', { name: 'Zoom in', exact: true }).click();
  expect(await expandedDiagram.getAttribute('style')).not.toBe(before);
  await expanded.getByRole('button', { name: 'Close diagram', exact: true }).click();
  await expect(expanded).toHaveCount(0);

  await window.setViewportSize({ width: 760, height: 650 });
  await assertFits();
});
