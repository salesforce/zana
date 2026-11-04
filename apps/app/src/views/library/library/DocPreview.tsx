import { LibraryAssetPreview } from './LibraryAssetPreview.js';
import { product } from '../../../lib/product-client.js';
import React, { useEffect, useRef, useState } from 'react';
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
import { extractMermaid } from '@/components/markdown-mermaid';
import { useMonacoTheme } from '@/hooks/useMonacoTheme';
import { useAiEnhanceSelection } from '@/components/AiEnhanceSelection';
import { StencilLines } from '@/components/ui/Skeleton';
import { parseFrontMatter } from '@zana-ai/zcc-extension-sdk/helpers';
import { LibraryMarkdownEditor } from './LibraryMarkdownEditor.js';
import { DocumentPdfButton } from '@/components/DocumentPdfButton';
import { LibrarySaveRecovery } from './LibrarySaveRecovery.js';
import { DocumentLinkBoundary } from '../../../components/DocumentLinkBoundary.js';
import { documentLinkUrlTransform, type DocumentLink } from '../../../components/document-links.js';

export interface DocPreviewProps {
  doc: LibraryDoc;
  fragment?: string;
  onOpenDocument?: (link: DocumentLink) => void;
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
export function DocPreview({ doc, autoEdit, onAutoEditConsumed, fragment, onOpenDocument }: DocPreviewProps) {
  const pushToast = useUi((s) => s.pushToast);
  const monacoTheme = useMonacoTheme();
  const [content, setContent] = useState<string | null>(null);
  const [revision, setRevision] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Markdown editing: only `md` docs are editable. `draft` holds unsaved
  // keystrokes; null ⇒ not editing (preview mode).
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const [saveAttempt, setSaveAttempt] = useState(0);
  const identity = JSON.stringify([doc.scope, doc.projectId, doc.id, doc.relPath, doc.absPath, doc.kind]);
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const operationEpoch = useRef(0);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [editSurface, setEditSurface] = useState<EditSurface>('rich');
  const editable = doc.kind === 'md' && doc.id !== '' && !!doc.relPath;
  const { registerEditor, modal: aiEnhanceModal } = useAiEnhanceSelection();

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setContent(null);
    setRevision(undefined);
    setEditing(false);
    setSaving(false);
    setSaveError(undefined);
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
          if (!active) return;
          if (result.ok && result.content !== undefined) {
            setContent(result.content);
            setRevision(result.sha256);
          } else {
            setError(result.message ?? 'Failed to read file');
          }
        })
        .catch((err) => { if (active) setError(String(err)); })
        .finally(() => { if (active) setLoading(false); });
    } else {
      setLoading(false);
    }
    return () => { active = false; };
  }, [doc.absPath, doc.kind, doc.relPath, doc.scope, doc.projectId, doc.id]);
  useEffect(() => { operationEpoch.current++; return () => { operationEpoch.current++; }; }, [identity]);

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
    setSaveError(undefined);
    setDraft(content ?? '');
    setEditSurface('rich');
    setEditing(true);
  };

  const saveEdit = async (expectedRevision = revision) => {
    if (!doc.relPath || saving) return;
    const target = identity;
    const epoch = operationEpoch.current;
    const isCurrent = () => identityRef.current === target && operationEpoch.current === epoch;
    const submitted = draft;
    setSaving(true);
    setSaveAttempt(value => value + 1);
    try {
      // Save through the scope-confined library seam (twin of the read above) so
      // a global doc's save isn't rejected by the project-confined fs.writeFile.
      const res = await product.library.write(doc.scope ?? 'global', doc.relPath, submitted, doc.projectId, expectedRevision);
      if (!isCurrent()) return;
      if (!res.ok) {
        setSaveError(res.message ?? 'Save failed');
        pushToast(res.message ?? 'Save failed', 'error');
        return;
      }
      setContent(submitted);
      setRevision(res.sha256);
      setSaveError(undefined);
      // Keystrokes entered while the write was in flight remain an unsaved
      // draft based on the acknowledged revision, rather than disappearing.
      if (draftRef.current === submitted) setEditing(false);
      // Keep the manifest title in step with the note's first heading so the
      // list label tracks what the idea is actually about. Best-effort.
      const heading = firstHeading(submitted);
      if (heading && heading !== doc.title) {
        try {
          await product.library.update(doc.id, { title: heading }, { scope: doc.scope ?? 'global', projectId: doc.projectId, relPath: doc.relPath });
        } catch {
          /* title sync is best-effort; the file is already saved */
        }
      }
      if (isCurrent()) pushToast('Saved');
    } catch (err) {
      if (isCurrent()) { setSaveError(`Save failed: ${err}`); pushToast(`Save failed: ${err}`, 'error'); }
    } finally {
      if (isCurrent()) setSaving(false);
    }
  };

  if (doc.kind === 'image' || doc.kind === 'pdf') return <LibraryAssetPreview key={`${doc.scope}:${doc.projectId}:${doc.relPath}`} doc={doc} />;

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
      <DocumentLinkBoundary className="library-md-pane" documentPath={doc.relPath} fragment={fragment}
        onOpenDocument={link => {
          if (editing && draft !== content && !window.confirm('Discard unsaved changes?')) return;
          onOpenDocument?.(link);
        }}>
        <div className="library-edit-bar">
          <DocumentPdfButton
            path={doc.relPath}
            title={doc.title}
            content={editing ? draft : content}
          />
          {editing ? (
            <>
              <button
                type="button"
                className="library-edit-btn primary"
                onClick={() => void saveEdit()}
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
        {editing && saveError && <LibrarySaveRecovery key={`${identity}:${saveAttempt}`} doc={doc} message={saveError} draft={draft} saving={saving}
          onSaveMerged={saveEdit} onUseLatest={(text, nextRevision) => {
            setContent(text); setDraft(text); setRevision(nextRevision); setSaveError(undefined); setEditing(false);
          }} />}
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
      </DocumentLinkBoundary>
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
      urlTransform={documentLinkUrlTransform}
      components={{
        pre: (props) => {
          const mermaid = extractMermaid(props.children);
          if (mermaid !== null) return <MermaidDiagram code={mermaid} exportable />;
          return <pre {...props} />;
        }
      }}
    >
      {parseFrontMatter(text)?.body ?? text}
    </ReactMarkdown>
  );
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
