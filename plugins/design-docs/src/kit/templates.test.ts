import { describe, expect, it, vi } from 'vitest';
import { renderTemplateFiles, templateById } from '../shared/templates.js';
import { createKit } from './index.js';
import { load, newWindow } from './test-window.js';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** The template's pages as the kit sees them: every chart draws, nothing is reported. */
async function enhanced(id: string) {
  const files = renderTemplateFiles(templateById(id)!, { title: 'Report', summary: 'Numbers' });
  const win = newWindow('https://pages.example/site/index.html');
  load(win, files.find((file) => file.path === 'index.html')!.content);
  Object.defineProperty(win, 'fetch', {
    configurable: true,
    value: vi.fn(async (path: string) => {
      const file = files.find((candidate) => candidate.path === path);
      return file ? new win.Response(file.content) : new win.Response('', { status: 404 });
    })
  });
  const report = vi.fn();
  Object.defineProperty(win, 'reportError', { value: report, configurable: true });
  createKit(win).enhance();
  await flush();
  await flush();
  return { doc: win.document, report };
}

describe('site templates under the kit', () => {
  it('draws every chart and sparkline of the report', async () => {
    const { doc, report } = await enhanced('report');
    expect(report).not.toHaveBeenCalled();
    expect(doc.querySelectorAll('.callout.critical')).toHaveLength(0);
    const figures = [...doc.querySelectorAll('figure.chart')];
    expect(figures).toHaveLength(4);
    for (const figure of figures) expect(figure.querySelector('.chart-plot svg')).not.toBeNull();
    expect(doc.querySelector('#trend figure .chart-line')).not.toBeNull();
    expect(doc.querySelectorAll('svg.spark path.chart-spark')).toHaveLength(3);
    expect(doc.querySelectorAll('#runs th button.sort')).toHaveLength(5);
    expect(doc.querySelector('.tab-list')!.getAttribute('role')).toBe('tablist');
  });

  it('wires the HTML design doc', async () => {
    const { doc, report } = await enhanced('html-design');
    expect(report).not.toHaveBeenCalled();
    expect(doc.querySelectorAll('.site-header nav a')).toHaveLength(7);
    expect(doc.querySelectorAll('#alternatives th button.sort')).toHaveLength(4);
  });
});
