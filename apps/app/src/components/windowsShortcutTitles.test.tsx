// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { FsReadResult, Project, TerminalSession } from '@zana-ai/zcc-domain/product';

vi.mock('@monaco-editor/react', () => ({ default: () => null, DiffEditor: () => null }));

import { TabBar } from './TabBar';
import { FileViewer } from './explorer/FileViewer';
import { PromptComposer } from './PromptComposer';

beforeEach(() => vi.stubGlobal('navigator', { ...navigator, platform: 'Win32' }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('spells the tab context-menu reopen shortcut as Ctrl+Shift+T on Windows', () => {
  const tab = { id: 't1', projectId: 'p1', title: 'shell', status: 'running', profile: 'shell' } as unknown as TerminalSession;
  render(<TabBar tabs={[tab]} activeTabId="t1" onSelect={() => {}} onClose={() => {}} onNewTerminal={() => {}} />);
  fireEvent.contextMenu(screen.getByText('shell'));
  expect(screen.getByRole('button', { name: 'Close' }).getAttribute('title')).toContain('press Ctrl+Shift+T to re-open');
  expect(screen.getByRole('button', { name: 'Delete' }).getAttribute('title')).toBe('Terminate this session and remove the tab. Reopen with Ctrl+Shift+T.');
});

it('labels the dirty-file Save button with Ctrl+S on Windows', () => {
  const noop = () => {};
  render(
    <FileViewer
      project={{ id: 'p1', name: 'P', path: '/tmp/p1', createdAt: 0, lastActiveAt: 0 } as Project}
      explorerFile="/tmp/p1/a.ts"
      fileResult={{ ok: true, content: 'old', bytes: 3 } as FsReadResult}
      fileLoading={false}
      editedContent="new"
      saving={false}
      previewMode={false}
      diffMode={false}
      diffAvailable={false}
      showDiff={false}
      showPreview={false}
      headResult={null}
      headLoading={false}
      imageDataUrl={null}
      imageError={null}
      viewRoot="/tmp/p1"
      monacoTheme="vs-dark"
      isRemote={false}
      isMarkdown={false}
      onContentChange={noop}
      onEditorMount={noop}
      onSave={noop}
      onTogglePreview={noop}
      onToggleDiff={noop}
    />
  );
  expect(screen.getByTitle('Save (Ctrl+S)')).toBeTruthy();
});

it('labels the home launcher submit button with Ctrl+Enter on Windows', () => {
  const noop = () => {};
  render(
    <PromptComposer
      variant="home"
      value="hi"
      onChange={noop}
      onSubmit={noop}
      submitLabel="Launch"
      attachments={[]}
      onAddAttachments={noop}
      onRemoveAttachment={noop}
    />
  );
  expect(screen.getByRole('button', { name: 'Launch' }).getAttribute('title')).toBe('Launch (Ctrl+Enter)');
  cleanup();
  render(<PromptComposer value="hi" onChange={noop} onSubmit={noop} submitLabel="Launch" attachments={[]} onAddAttachments={noop} onRemoveAttachment={noop} />);
  expect(screen.queryByTitle('Launch (Ctrl+Enter)')).toBeNull();
});
