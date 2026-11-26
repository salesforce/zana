import { useEffect, useMemo, useRef, useState } from 'react';
import {
  useRpc,
  useZccNavigate,
  type PluginThreadPanelProps
} from '@zana-ai/zcc-plugin-sdk/app';
import { libraryPanelSubPath } from '../library-panel-path.js';
import { LibraryMarkdownEditor } from './LibraryMarkdownEditor.js';
import {
  createLibraryAutosave,
  isHtmlLibraryPath,
  parseDocumentPanelParams
} from './document-panel-params.js';

export function DocumentPanel(props: PluginThreadPanelProps) {
  const rpc = useRpc();
  const navigate = useZccNavigate();
  const explicitDocument = useMemo(() => parseDocumentPanelParams(props.params), [props.params]);
  const ownerProjectId = explicitDocument ? undefined : props.projectId;
  // A late thread record supplies a missing owner without reloading already scoped drafts.
  const parsed = useMemo(() => explicitDocument ?? parseDocumentPanelParams(props.params, ownerProjectId), [explicitDocument, props.params, ownerProjectId]);
  const revision = useMemo(() => ({ value: undefined as string | undefined }), [parsed]);
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const autosave = useRef<ReturnType<typeof createLibraryAutosave> | null>(null);

  useEffect(() => {
    const saver = createLibraryAutosave(async (next) => {
      if (!parsed) return;
      const result = (await rpc.call('write', {
        path: parsed.path,
        scope: parsed.scope,
        content: next,
        expectedSha256: revision.value,
        ...(parsed.projectId ? { projectId: parsed.projectId } : {})
      })) as { ok?: boolean; message?: string; sha256?: string };
      if (result && result.ok === false) {
        throw new Error(result.message ?? 'Save failed');
      }
      revision.value = result?.sha256;
    }, undefined, error => setError(error instanceof Error ? error.message : String(error)));
    autosave.current = saver;
    return () => saver.flush();
  }, [parsed, rpc, revision]);

  useEffect(() => {
    if (!parsed) return;
    let cancelled = false;
    setContent(null);
    setError(null);
    void rpc
      .call('read', {
        path: parsed.path,
        scope: parsed.scope,
        ...(parsed.projectId ? { projectId: parsed.projectId } : {})
      })
      .then((result) => {
        if (cancelled) return;
        const row = result as { ok?: boolean; content?: string; message?: string; sha256?: string };
        if (!row?.ok) {
          setError(row?.message ?? 'Document not found');
          return;
        }
        revision.value = row.sha256;
        setContent(row.content ?? '');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [parsed, rpc, revision]);

  if (!parsed) {
    return (
      <div className="docs-document-panel-empty" role="status">
        This document link is missing a library path.
      </div>
    );
  }

  const openInLibrary = () => {
    navigate.toPluginPanel('panel', {
      subPath: libraryPanelSubPath({
        scope: parsed.scope,
        projectId: parsed.projectId,
        relPath: parsed.path
      })
    });
  };

  return (
    <div className="docs-document-panel">
      <header className="docs-document-panel-header">
        <div className="docs-document-panel-title" title={parsed.path}>
          {parsed.title}
        </div>
        <button type="button" className="docs-document-panel-open" onClick={openInLibrary}>
          Open in Library
        </button>
      </header>
      {error && <div className="docs-document-panel-status" role="alert">{error}</div>}
      {error && content === null ? null : content === null ? (
        <div className="docs-document-panel-status">Loading…</div>
      ) : isHtmlLibraryPath(parsed.path) ? (
        <div className="docs-document-panel-body">
          <iframe
            className="docs-html-frame"
            title={parsed.title}
            sandbox="allow-scripts"
            srcDoc={content}
          />
        </div>
      ) : (
        <div className="docs-document-panel-body">
          <LibraryMarkdownEditor
            value={content}
            onChange={(next) => {
              setContent(next);
              autosave.current?.schedule(next);
            }}
          />
        </div>
      )}
    </div>
  );
}
