// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { NodeViewProps } from '@tiptap/react';
import { MarkdownEditorImage, MarkdownImageContext } from './markdown-editor-nodes.js';
import { createLibraryMarkdownEditor } from '../../views/library/library/library-markdown.js';

const localImage = vi.hoisted(() => vi.fn());
vi.mock('../DocumentImage.js', () => ({ DocumentImage: (props: unknown) => { localImage(props); return <span>Authorized local image</span>; } }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
function image(attrs: Record<string, unknown>) { return { node: { attrs } } as unknown as NodeViewProps; }
it('renders remote images and alt/title attributes', () => {
  render(<MarkdownEditorImage {...image({ src: 'https://example.com/image.png', alt: 'Diagram', title: 'Title' })} />);
  expect(screen.getByRole('img').getAttribute('src')).toBe('https://example.com/image.png');
  expect(screen.getByRole('img').getAttribute('title')).toBe('Title');
  expect(localImage).not.toHaveBeenCalled();
});
it('routes local media through its recorded project, host and thread scope', () => {
  const scope = { documentPath: '/repo/doc.md', localImages: true, threadId: 'thread', storage: true, fileScope: { projectId: 'project', hostId: 'remote', environmentId: 'environment' } };
  render(<MarkdownImageContext.Provider value={scope}><MarkdownEditorImage {...image({ src: 'asset.png', alt: 'Asset' })} /></MarkdownImageContext.Provider>);
  expect(localImage).toHaveBeenCalledWith({ ...scope, src: 'asset.png', alt: 'Asset', title: undefined });
});
it.each(['javascript:evil()', 'file:///private/secret.png', 'data:image/svg+xml,<svg/>', 'asset.png'])('does not acquire local access or navigate for %s', src => {
  const { container } = render(<MarkdownEditorImage {...image({ src, alt: 'Unavailable' })} />);
  expect(container.querySelector('img')).toBeNull(); expect(screen.getByText('Unavailable')).toBeTruthy();
  expect(localImage).not.toHaveBeenCalled();
});
it('handles absent image attributes and represents HTML as literal source', () => {
  render(<MarkdownEditorImage {...image({})} />);
  const editor = createLibraryMarkdownEditor('');
  try {
    const json = editor.markdown!.parse('<script>evil()</script>\n');
    expect(JSON.stringify(json)).toContain('markdownSource');
    editor.commands.setContent(json);
    expect(editor.view.dom.querySelector('script')).toBeNull();
    expect(editor.getMarkdown()).toContain('<script>evil()</script>');
    editor.commands.setContent('<div data-markdown-source><pre><code>literal</code></pre></div>');
    expect(editor.getMarkdown()).toContain('literal');
    const source = editor.extensionManager.extensions.find(extension => extension.name === 'markdownSource')!;
    expect(source.config.parseMarkdown?.({ raw: '' } as never, {} as never)).toEqual({ type: 'markdownSource', content: [] });
    expect(source.config.renderMarkdown?.({ type: 'markdownSource' }, {} as never, {} as never)).toBe('');
  } finally { editor.destroy(); }
});

it('round-trips image destinations and labels with Markdown delimiters', () => {
  const editor = createLibraryMarkdownEditor('');
  try {
    const attributes = { src: 'my file).png', alt: 'A ] bracket', title: 'A "quoted" title' };
    editor.commands.setImage(attributes);
    const parsed = editor.markdown!.parse(editor.getMarkdown());
    editor.commands.setContent(parsed);
    const images: Record<string, unknown>[] = [];
    editor.state.doc.descendants(node => { if (node.type.name === 'image') images.push(node.attrs); });
    expect(images).toEqual([expect.objectContaining(attributes)]);
  } finally { editor.destroy(); }
});
