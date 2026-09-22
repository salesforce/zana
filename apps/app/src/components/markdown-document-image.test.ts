import { describe, expect, it } from 'vitest';
import { resolveDocumentImagePath } from './markdown-document-image.js';

describe('resolveDocumentImagePath', () => {
  it.each([
    ['README.md', 'docs/assets/architecture.svg', 'docs/assets/architecture.svg'],
    ['/project/README.md', 'docs/assets/architecture.svg', '/project/docs/assets/architecture.svg'],
    ['docs/guide.md', './assets/diagram.png', 'docs/assets/diagram.png'],
    ['docs/guides/intro.md', '../assets/diagram.png', 'docs/assets/diagram.png'],
    ['docs/guide.md', 'assets/my%20image%23one.png?raw=true#view', 'docs/assets/my image#one.png'],
    ['docs/guide.md', '/project/diagram.svg', '/project/diagram.svg'],
    ['docs/guide.md', 'file:///project/my%20image.svg#view', '/project/my image.svg'],
    ['docs/guide.md', 'file://localhost/project/image.svg', '/project/image.svg'],
    ['C:\\project\\docs\\guide.md', '..\\image.png', 'C:/project/image.png'],
    ['guide.md', 'C:\\project\\image.png', 'C:/project/image.png'],
    ['guide.md', '../../secret.png', '../../secret.png'],
    ['/project/guide.md', '../../secret.png', '/../secret.png'],
    ['C:/guide.md', '../secret.png', 'C:/../secret.png']
  ])('resolves %s + %s', (doc, src, expected) => {
    expect(resolveDocumentImagePath(doc, src)).toBe(expected);
  });

  it.each(['', '#view', '//example.com/image.png', 'https://example.com/a.png',
    'data:image/png;base64,AA', 'javascript:alert(1)', 'file://other-host/image.png',
    'file://[invalid', 'invalid%XX.png', 'bad%00.png', '?raw=true'])('rejects %s', (src) => {
    expect(resolveDocumentImagePath('guide.md', src)).toBeNull();
  });
});
