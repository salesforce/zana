// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useData } from '../../store.js';
import { FileIcon, FolderIcon } from '../FileIcon.js';
import { resolveFileIcon } from '../../lib/fileIcons/resolveFileIcon.js';

beforeEach(() => useData.setState({ explorerFileIconTheme: 'seti' }));
afterEach(cleanup);

describe('FileIcon', () => {
  it('renders the Seti glyph and color class for the file, hidden from assistive tech', () => {
    const { container } = render(<FileIcon name="main.ts" />);
    const span = container.querySelector('span.file-icon') as HTMLElement;
    const { id, char } = resolveFileIcon('main.ts');
    expect(span.className).toContain(`seti-${id}`);
    expect(span.textContent).toBe(char);
    expect(span.getAttribute('aria-hidden')).toBe('true');
  });

  it('scales the glyph with the requested size', () => {
    const { container } = render(<FileIcon name="a.md" size={16} />);
    expect((container.querySelector('.file-icon') as HTMLElement).style.fontSize).toBe('20px');
  });

  it('renders one plain lucide glyph under the minimal theme', () => {
    useData.setState({ explorerFileIconTheme: 'minimal' });
    const { container } = render(<FileIcon name="main.ts" />);
    expect(container.querySelector('.file-icon')).toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('renders nothing under the none theme', () => {
    useData.setState({ explorerFileIconTheme: 'none' });
    const { container } = render(<FileIcon name="main.ts" />);
    expect(container.innerHTML).toBe('');
  });
});

describe('FolderIcon', () => {
  it('renders a closed and an open folder glyph', () => {
    const closed = render(<FolderIcon />).container.innerHTML;
    cleanup();
    const open = render(<FolderIcon open />).container.innerHTML;
    expect(closed).toContain('svg');
    expect(open).toContain('svg');
    expect(open).not.toBe(closed);
  });

  it('respects explorerFileIconTheme and hides under none', () => {
    useData.setState({ explorerFileIconTheme: 'none' });
    expect(render(<FolderIcon />).container.innerHTML).toBe('');
    cleanup();
    useData.setState({ explorerFileIconTheme: 'minimal' });
    expect(render(<FolderIcon />).container.querySelector('svg')).not.toBeNull();
    cleanup();
    useData.setState({ explorerFileIconTheme: 'seti' });
    expect(render(<FolderIcon />).container.querySelector('svg')).not.toBeNull();
  });
});
