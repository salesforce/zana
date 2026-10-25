import React, { lazy } from 'react';
import { FileText, Save, Eye, Pencil, GitCompare } from 'lucide-react';
import type { OnMount } from '@monaco-editor/react';
import type { FsReadResult, GitShowResult, Project } from '@zana-ai/zcc-domain/product';
import { ViewerBoundary } from './ViewerBoundary.js';
import { OpenerButtons } from '../OpenerButtons.js';
import { languageFromPath } from '../../lib/monacoLanguage.js';
import { StencilLines } from '../ui/Skeleton.js';
import { platformShortcut } from '../../lib/platformShortcut.js';
import { MinimapContextMenu } from './MinimapContextMenu.js';
import { useMonacoMinimap } from './useMonacoMinimap.js';

const Editor = lazy(() => import('./ExplorerEditor.js'));
const MarkdownPreview = lazy(() => import('./MarkdownPreview.js'));
const DiffViewer = lazy(() => import('../DiffViewer.js').then(module => ({ default: module.DiffViewer })));

interface FileViewerProps {
  project: Project;
  explorerFile: string | undefined;
  fileResult: FsReadResult | null;
  fileLoading: boolean;
  editedContent: string | null;
  saving: boolean;
  previewMode: boolean;
  diffMode: boolean;
  diffAvailable: boolean;
  showDiff: boolean;
  showPreview: boolean;
  headResult: GitShowResult | null;
  headLoading: boolean;
  imageDataUrl: string | null;
  imageError: string | null;
  viewRoot: string;
  monacoTheme: string;
  isRemote: boolean;
  nativeFiles?: boolean;
  isMarkdown: boolean;
  onContentChange: (content: string | null) => void;
  onEditorMount: OnMount;
  aiEnhanceModal?: React.ReactNode;
  onSave: () => void;
  onTogglePreview: () => void;
  onToggleDiff: () => void;
}

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function trimPath(file: string, root: string) {
  if (file.startsWith(root)) {
    const rest = file.slice(root.length);
    return rest.startsWith('/') ? rest.slice(1) : rest;
  }
  return file;
}

function isImagePath(path: string): boolean {
  const lower = path.toLowerCase();
  const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico', '.avif'];
  return IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function FileViewer({
  project,
  explorerFile,
  fileResult,
  fileLoading,
  editedContent,
  saving,
  previewMode,
  diffMode,
  diffAvailable,
  showDiff,
  showPreview,
  headResult,
  headLoading,
  imageDataUrl,
  imageError,
  viewRoot,
  monacoTheme,
  isRemote,
  nativeFiles = true,
  isMarkdown,
  onContentChange,
  onEditorMount,
  aiEnhanceModal,
  onSave,
  onTogglePreview,
  onToggleDiff
}: FileViewerProps) {
  const {
    minimap,
    minimapPrefs,
    updateMinimap,
    autoHidden,
    minimapMenu,
    handleMonacoRef,
    handleEditorMount,
    closeMinimapMenu
  } = useMonacoMinimap(explorerFile, onEditorMount);

  if (!explorerFile) {
    return (
      <section className="explorer-viewer">
        <div className="explorer-viewer-empty">
          <FileText size={32} />
          <p>Select a file from the tree to view it.</p>
        </div>
      </section>
    );
  }

  if (fileLoading) {
    return (
      <section className="explorer-viewer">
        <div className="explorer-viewer-empty">
          <StencilLines label="Loading file" />
        </div>
      </section>
    );
  }

  if (!fileResult) {
    return <section className="explorer-viewer" />;
  }

  if (!fileResult.ok) {
    return (
      <section className="explorer-viewer">
        <div className="explorer-viewer-empty">
          <p>Failed to read file:</p>
          <p style={{ color: 'var(--danger)' }}>{fileResult.message}</p>
        </div>
      </section>
    );
  }

  if (fileResult.binary) {
    if (!isRemote && explorerFile && isImagePath(explorerFile)) {
      if (imageDataUrl) {
        return (
          <section className="explorer-viewer">
            <div className="explorer-image-preview">
              <img src={imageDataUrl} alt={trimPath(explorerFile, viewRoot)} />
            </div>
          </section>
        );
      }
      if (imageError) {
        return (
          <section className="explorer-viewer">
            <div className="explorer-viewer-empty">
              <p>Failed to read image:</p>
              <p style={{ color: 'var(--danger)' }}>{imageError}</p>
            </div>
          </section>
        );
      }
      return (
        <section className="explorer-viewer">
          <div className="explorer-viewer-empty">
            <StencilLines label="Loading image" />
          </div>
        </section>
      );
    }

    return (
      <section className="explorer-viewer">
        <div className="explorer-viewer-empty">
          <p>Binary file ({formatBytes(fileResult.bytes ?? 0)})</p>
        </div>
      </section>
    );
  }

  const isDirty = editedContent !== null && editedContent !== (fileResult.content ?? '');

  return (
    <section className="explorer-viewer">
      <div className="explorer-viewer-header">
        <span className="explorer-viewer-path" title={explorerFile}>
          {trimPath(explorerFile, viewRoot)}
          {isDirty && <span className="explorer-viewer-dirty" title="Unsaved changes">●</span>}
        </span>
        {fileResult.truncated && (
          <span className="explorer-viewer-warn">truncated · 2MB cap (read-only)</span>
        )}
        <span className="explorer-viewer-meta">
          {formatBytes(fileResult.bytes ?? 0)}
        </span>
        <span className="explorer-viewer-actions">
          {isDirty && (
            <button
              type="button"
              className="opener-btn active"
              title={platformShortcut('Save (⌘S)')}
              disabled={saving}
              onClick={onSave}
            >
              <Save size={13} />
            </button>
          )}
          {isMarkdown && !showDiff && (
            <button
              type="button"
              className={`opener-btn ${previewMode ? 'active' : ''}`}
              title={previewMode ? 'Edit markdown' : 'Preview markdown'}
              aria-pressed={previewMode}
              onClick={onTogglePreview}
            >
              {previewMode ? <Pencil size={13} /> : <Eye size={13} />}
            </button>
          )}
          {diffAvailable && (
            <button
              type="button"
              className={`opener-btn ${diffMode ? 'active' : ''}`}
              title={
                diffMode
                  ? 'Show current file'
                  : 'Show diff against HEAD'
              }
              aria-pressed={diffMode}
              onClick={onToggleDiff}
            >
              <GitCompare size={13} />
            </button>
          )}
          {isRemote ? (
            <span className="explorer-viewer-warn">remote · {project.remote?.host}</span>
          ) : (
            nativeFiles ? <OpenerButtons path={explorerFile} projectRoot={viewRoot} /> : null
          )}
        </span>
      </div>
      <div className="explorer-viewer-monaco" ref={handleMonacoRef}>
        <ViewerBoundary key={showPreview ? 'preview' : showDiff ? 'diff' : 'editor'} resetKey={explorerFile}>
          {showPreview ? (
            <MarkdownPreview content={editedContent ?? fileResult.content ?? ''} />
          ) : showDiff ? (
            headLoading || !headResult ? (
              <div className="explorer-viewer-empty">
                <StencilLines label="Loading HEAD" />
              </div>
            ) : !headResult.ok ? (
              <div className="explorer-viewer-empty">
                <p>Failed to read HEAD:</p>
                <p style={{ color: 'var(--danger)' }}>{headResult.message}</p>
              </div>
            ) : headResult.binary ? (
              <div className="explorer-viewer-empty">
                <p>HEAD blob is binary; cannot diff as text.</p>
              </div>
            ) : (
              <DiffViewer
                path={explorerFile}
                language={languageFromPath(explorerFile)}
                original={headResult.content ?? ''}
                modified={fileResult.content ?? ''}
              />
            )
          ) : (
            <Editor
              height="100%"
              width="100%"
              theme={monacoTheme}
              path={explorerFile}
              language={languageFromPath(explorerFile)}
              value={editedContent ?? fileResult.content ?? ''}
              onChange={(v) => {
                if (v === undefined) return;
                // Only flip into "dirty" when the value actually diverges
                // from disk; an identical edit (revert) clears the buffer.
                if (v === (fileResult.content ?? '')) {
                  onContentChange(null);
                } else {
                  onContentChange(v);
                }
              }}
              onMount={handleEditorMount}
              options={{
                readOnly: fileResult.truncated,
                minimap,
                fontSize: 13,
                scrollBeyondLastLine: false,
                automaticLayout: true,
                renderLineHighlight: 'all',
                wordWrap: 'off'
              }}
            />
          )}
        </ViewerBoundary>
        {aiEnhanceModal}
        {minimapMenu && (
          <MinimapContextMenu
            prefs={minimapPrefs}
            autoHidden={autoHidden}
            x={minimapMenu.x}
            y={minimapMenu.y}
            onChange={updateMinimap}
            onClose={closeMinimapMenu}
          />
        )}
      </div>
    </section>
  );
}
