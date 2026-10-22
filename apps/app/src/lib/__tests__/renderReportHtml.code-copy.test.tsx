// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderReportHtml } from '../renderReportHtml.js';

describe('renderReportHtml code blocks', () => {
  it('prints fenced code without the on-screen copy button', async () => {
    const html = await renderReportHtml({
      title: 'Report',
      docs: [{ path: 'notes.md', content: '```ts\nconst docBlock = 1;\n```' }],
      comments: '```sh\necho commentBlock\n```'
    });
    expect(html).toContain('docBlock');
    expect(html).toContain('commentBlock');
    expect(html).not.toContain('inbox-md-codeblock');
    expect(html).not.toContain('Copy code');
  });
});
