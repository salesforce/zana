import { product } from '../../../lib/product-client.js';
import React, { useEffect, useState, isValidElement, type ReactNode } from 'react';
import { Pencil, Eye, Save, Type, Code2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Editor from '@monaco-editor/react';
// Side-effect: wires up MonacoEnvironment (local workers) + loader.config. See
// util/monacoSetup.ts — shared with ExplorerView and the modal's DiffViewer.
import '@/lib/monacoSetup';

import type { LibraryDoc } from '@zana-ai/zcc-domain/product';
import { useUi } from '@/store';
import { MermaidDiagram } from '@/components/MermaidDiagram';
import { useMonacoTheme } from '@/hooks/useMonacoTheme';
import { useAiEnhanceSelection } from '@/components/AiEnhanceSelection';
import { StencilLines } from '@/components/ui/Skeleton';
import { parseFrontMatter } from '@zana-ai/zcc-extension-sdk/helpers';
import { LibraryMarkdownEditor } from './LibraryMarkdownEditor.js';

export interface DocPreviewProps {
  doc: LibraryDoc;
  /** Open straight into edit mode (used right after "New idea"/"New note"). */
  autoEdit?: boolean;
  onAutoEditConsumed?: () => void;
}

type EditSurface = 'rich' | 'source';

/**
 * Preview + (for markdown) inline edit for a single library doc. Shared by the
 * per-project LibraryView and the global cross-project LibraryPanel — both read
 * through the same scope-confined `product.library.read/write` seam, so a
 * doc's scope (global vs project) is opaque to this component.
 */
export function DocPreview({ doc, autoEdit, onAutoEditConsumed }: DocPreviewProps) {
  const pushToast = useUi((s) => s.pushToast);
  const monacoTheme = useMonacoTheme();
  const [content, setContent] = useState<string | null>(null);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Markdown editing: only `md` docs are editable. `draft` holds unsaved
  // keystrokes; null ⇒ not editing (preview mode).
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [editSurface, setEditSurface] = useState<EditSurface>('rich');
  const editable = doc.kind === 'md' && doc.id !== '' && !!doc.relPath;
  const { registerEditor, modal: aiEnhanceModal } = useAiEnhanceSelection();

  useEffect(() => {
    setLoading(true);
    setError(null);
    setContent(null);
    setDataUrl(null);
    setEditing(false);
    setEditSurface('rich');

    if (doc.kind === 'md' || doc.kind === 'code') {
      // Read as text through the library's own scope-confined seam — a GLOBAL
      // doc lives in ~/.zcc/library, outside any registered project, so the
      // generic project-confined fs.readFile would reject it. Pass scope +
      // relPath (never the absPath) so main resolves the trusted dir itself.
      if (!doc.relPath) {
        setError('No path available');
        setLoading(false);
        return;
      }
      product.library
        .read(doc.scope ?? 'global', doc.relPath, doc.projectId)
        .then((result) => {
          if (result.ok && result.content !== undefined) {
            setContent(result.content);
          } else {
            setError(result.message ?? 'Failed to read file');
          }
        })
        .catch((err) => setError(String(err)))
        .finally(() => setLoading(false));
    } else if (!doc.absPath) {
      setError('No absolute path available');
      setLoading(false);
    } else if (doc.kind === 'image') {
      // Read as data URL
      product.fs
        .readDataUrl(doc.absPath)
        .then((result) => {
          if (result.ok && result.dataUrl) {
            setDataUrl(result.dataUrl);
          } else {
            setError(result.message ?? 'Failed to read image');
          }
        })
        .catch((err) => setError(String(err)))
        .finally(() => setLoading(false));
    } else {
      // PDF or other
      setLoading(false);
    }
  }, [doc.absPath, doc.kind, doc.relPath, doc.scope, doc.projectId]);

  // Honor "open in edit mode" once the content has loaded (new idea flow).
  useEffect(() => {
    if (autoEdit && editable && content !== null) {
      setDraft(content);
      setEditSurface('rich');
      setEditing(true);
      onAutoEditConsumed?.();
    }
  }, [autoEdit, editable, content, onAutoEditConsumed]);

  const beginEdit = () => {
    setDraft(content ?? '');
    setEditSurface('rich');
    setEditing(true);
  };

  const saveEdit = async () => {
    if (!doc.relPath) return;
    setSaving(true);
    try {
      // Save through the scope-confined library seam (twin of the read above) so
      // a global doc's save isn't rejected by the project-confined fs.writeFile.
      const res = await product.library.write(doc.scope ?? 'global', doc.relPath, draft, doc.projectId);
      if (!res.ok) {
        pushToast(res.message ?? 'Save failed', 'error');
        return;
      }
      setContent(draft);
      setEditing(false);
      // Keep the manifest title in step with the note's first heading so the
      // list label tracks what the idea is actually about. Best-effort.
      const heading = firstHeading(draft);
      if (heading && heading !== doc.title) {
        try {
          await product.library.update(doc.id, { title: heading });
        } catch {
          /* title sync is best-effort; the file is already saved */
        }
      }
      pushToast('Saved');
    } catch (err) {
      pushToast(`Save failed: ${err}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <StencilLines label="Loading document" className="explorer-viewer-empty" />;
  }

  if (error) {
    return (
      <div className="explorer-viewer-empty">
        <p style={{ color: 'var(--error)' }}>{error}</p>
      </div>
    );
  }

  // Markdown: editable for tracked idea/notes. Edit opens a WYSIWYG surface
  // (BB Docs-style); Source switches to full-width Monaco for raw markdown.
  if (doc.kind === 'md' && content !== null) {
    return (
      <div className="library-md-pane">
        <div className="library-edit-bar">
          {editing ? (
            <>
              <button
                type="button"
                className="library-edit-btn primary"
                onClick={saveEdit}
                disabled={saving}
                title="Save (writes the file)"
              >
                <Save size={13} />
                <span>{saving ? 'Saving…' : 'Save'}</span>
              </button>
              <button
                type="button"
                className={`library-edit-btn${editSurface === 'rich' ? ' active' : ''}`}
                onClick={() => setEditSurface('rich')}
                disabled={saving}
                aria-pressed={editSurface === 'rich'}
                title="Rich text editor"
              >
                <Type size={13} />
                <span>Rich</span>
              </button>
              <button
                type="button"
                className={`library-edit-btn${editSurface === 'source' ? ' active' : ''}`}
                onClick={() => setEditSurface('source')}
                disabled={saving}
                aria-pressed={editSurface === 'source'}
                title="Markdown source"
              >
                <Code2 size={13} />
                <span>Source</span>
              </button>
              <button
                type="button"
                className="library-edit-btn"
                onClick={() => setEditing(false)}
                disabled={saving}
                title="Discard changes and return to preview"
              >
                <Eye size={13} />
                <span>Preview</span>
              </button>
            </>
          ) : (
            editable && (
              <button
                type="button"
                className="library-edit-btn"
                onClick={beginEdit}
                title="Edit this note"
              >
                <Pencil size={13} />
                <span>Edit</span>
              </button>
            )
          )}
        </div>
        {editing ? (
          editSurface === 'rich' ? (
            <LibraryMarkdownEditor value={draft} onChange={setDraft} autofocus />
          ) : (
            <div className="explorer-viewer-monaco">
              <Editor
                value={draft}
                language="markdown"
                theme={monacoTheme}
                onChange={(v) => setDraft(v ?? '')}
                onMount={registerEditor}
                options={{
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  fontSize: 13,
                  lineNumbers: 'on',
                  wordWrap: 'on'
                }}
              />
              {aiEnhanceModal}
            </div>
          )
        ) : (
          <div className="explorer-md-preview">
            <div className="inbox-md">{renderMarkdownBody(content)}</div>
          </div>
        )}
      </div>
    );
  }

  // Code preview (Monaco)
  if (doc.kind === 'code' && content !== null) {
    const language = languageFromPath(doc.relPath);
    return (
      <div className="explorer-viewer-monaco">
        <Editor
          value={content}
          language={language}
          theme={monacoTheme}
          options={{
            readOnly: true,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            fontSize: 13,
            lineNumbers: 'on',
            folding: true,
            wordWrap: 'on'
          }}
        />
      </div>
    );
  }

  // Image preview
  if (doc.kind === 'image' && dataUrl !== null) {
    return (
      <div className="library-image-preview">
        <img src={dataUrl} alt={doc.title} />
      </div>
    );
  }

  // PDF preview (webview). Encode the path so spaces / # / ? in the absolute
  // path (common under ~/Documents/…) don't truncate or break the file: URL.
  if (doc.kind === 'pdf' && doc.absPath) {
    const fileUrl = `file://${doc.absPath.split('/').map(encodeURIComponent).join('/')}`;
    return (
      <webview
        src={fileUrl}
        className="library-pdf-preview"
        // @ts-expect-error — electron webview attributes not in JSX types
        allowpopups="false"
      />
    );
  }

  // Other files — just show reveal button
  return (
    <div className="explorer-viewer-empty">
      <p>Preview not available for this file type</p>
    </div>
  );
}

/**
 * Rendered markdown body for the read-only preview — strips the `---`…`---`
 * front-matter header (the manifest already shows title/summary/tags) and
 * renders mermaid fences as diagrams.
 */
function renderMarkdownBody(text: string) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        pre: (props) => {
          const mermaid = extractMermaid(props.children);
          if (mermaid !== null) return <MermaidDiagram key={mermaid} code={mermaid} exportable />;
          return <pre {...props} />;
        }
      }}
    >
      {parseFrontMatter(text)?.body ?? text}
    </ReactMarkdown>
  );
}

/**
 * Given the children of a markdown `<pre>` (which react-markdown renders as a
 * single `<code className="language-…">` element), return the raw source if
 * it's a ```mermaid fence, otherwise null. Returning null lets the caller
 * fall back to the default code-block rendering.
 */
function extractMermaid(children: ReactNode): string | null {
  if (!isValidElement(children)) return null;
  const props = children.props as { className?: string; children?: ReactNode };
  const className = props.className ?? '';
  if (!/(^|\s)language-mermaid(\s|$)/.test(className)) return null;
  const source = props.children;
  return typeof source === 'string' ? source.replace(/\n$/, '') : null;
}

/**
 * First markdown heading of a note (a `#` line), trimmed, or null. Used to keep
 * a note's manifest title in step with its content on save.
 */
function firstHeading(text: string): string | null {
  for (const line of text.split('\n')) {
    const m = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line.trim());
    if (m) return m[1].trim();
  }
  return null;
}

/**
 * Guess Monaco language from file extension.
 */
function languageFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    js: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    json: 'json',
    md: 'markdown',
    html: 'html',
    css: 'css',
    scss: 'scss',
    less: 'less',
    py: 'python',
    rb: 'ruby',
    go: 'go',
    rs: 'rust',
    java: 'java',
    c: 'c',
    cpp: 'cpp',
    cs: 'csharp',
    php: 'php',
    sh: 'shell',
    bash: 'shell',
    zsh: 'shell',
    yaml: 'yaml',
    yml: 'yaml',
    xml: 'xml',
    sql: 'sql'
  };
  return map[ext] ?? 'plaintext';
}
