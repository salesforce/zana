import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DocActor } from '../shared/contract.js';
import { renderTemplateFiles, templateById } from '../shared/templates.js';
import { createKitReader, renderPage } from './pages.js';
import { DesignDocStore } from './store.js';
import { createTestDatabase } from './test-db.js';

const user: DocActor = { kind: 'user', label: 'You', threadId: null };
const kit = createKitReader(join(import.meta.dirname, '../../kit'));

describe('site templates', () => {
  for (const id of ['report', 'html-design']) {
    it(`${id} opens on its home page, which loads the kit and lacks nothing`, () => {
      const store = new DesignDocStore(createTestDatabase());
      const doc = store.create({ title: 'Agent benchmark', summary: 'Weekly numbers', template: id }, user);
      expect(doc.entryPath).toBe('index.html');
      const page = renderPage(store, kit, { doc: doc.id });
      expect(page.missing).toEqual([]);
      expect(page.warnings).toEqual([]);
      expect(page.deps.map((dep) => dep.path)).toEqual(expect.arrayContaining(['zcc-kit/site.css', 'zcc-kit/site.js']));
      expect(page.html).toContain('Agent benchmark');
    });
  }

  it('escapes the title and summary in pages, not in other files', () => {
    const values = { title: 'A & <B>', summary: '"quoted"' };
    const report = renderTemplateFiles(templateById('report')!, values);
    const index = report.find((file) => file.path === 'index.html')!.content;
    expect(index).toContain('<title>A &#38; &#60;B&#62;</title>');
    expect(index).toContain('<p class="lede">&#34;quoted&#34;</p>');
    expect(index).not.toContain('{{');
    const technical = renderTemplateFiles(templateById('technical')!, values);
    expect(technical[0]!.content).toContain('# A & <B>');
  });
});
