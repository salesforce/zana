import { useEffect, useState, useSyncExternalStore } from 'react';
import { Copy, FileText } from 'lucide-react';
import { product } from '../../../lib/product-client.js';
import { DocContent } from '../../MarkdownContent.js';
import { PluginSlotBoundary } from '../../../plugins/PluginSlotBoundary.js';
import { listFileOpeners, subscribePluginSlots } from '../../../plugins/plugin-slots.js';
import {
  fileExtensionOf,
  fileOpenerKey,
  matchingFileOpeners,
  resolveFileOpener,
  writeFileOpenerPin
} from '../../../plugins/plugin-slot-resolvers.js';
import type { PluginFileOpenerRegistration } from '@zana-ai/zcc-plugin-sdk';
import { SecondaryPanelSelectionActions } from './SecondaryPanelSelectionActions.js';
import {
  applyPreviewResult,
  copyText,
  loadFilePreview,
  previewKind,
  previewPathParts
} from './threadSecondaryPanelLogic.js';
import { StencilLines } from '../../ui/Skeleton.js';

export function ThreadFilePreviewView({
  path,
  content,
  error,
  threadId,
  projectId
}: {
  path: string;
  content: string | null;
  error: string | null;
  threadId?: string;
  projectId?: string | null;
}) {
  if (error) return <p className="thread-detail-empty">{error}</p>;
  if (content === null) {
    return (
      <StencilLines
        label="Loading file"
        widths={['75%', '100%', '83%', '67%']}
        className="zcc-stencil-padded"
      />
    );
  }
  if (previewKind(path, content) === 'image') {
    return <img className="thread-file-preview-image" src={content} alt={path} />;
  }
  return (
    <div className="thread-file-preview" data-testid="thread-file-preview">
      <DocContent
        path={path}
        content={content}
        exportable
        threadId={threadId}
        projectId={projectId}
      />
    </div>
  );
}

export function ThreadFilePreviewChrome({
  path,
  matches,
  selectedKey,
  onSelect
}: {
  path: string;
  matches: readonly PluginFileOpenerRegistration[];
  selectedKey: string;
  onSelect: (key: string) => void;
}) {
  const { name, dir } = previewPathParts(path);
  const [copied, setCopied] = useState(false);
  return (
    <header className="thread-file-preview-chrome" data-testid="thread-file-preview-chrome">
      <FileText size={14} strokeWidth={1.75} className="thread-file-preview-chrome-icon" aria-hidden />
      <span className="thread-file-preview-path" title={path}>
        {dir ? <span className="thread-file-preview-dir">{dir}/</span> : null}
        <span className="thread-file-preview-name">{name}</span>
      </span>
      <div className="thread-file-preview-chrome-actions">
        <button
          type="button"
          className="thread-file-preview-copy"
          data-testid="thread-file-preview-copy"
          aria-label={copied ? 'Copied' : 'Copy path'}
          title={copied ? 'Copied' : 'Copy path'}
          onClick={() => {
            void copyText(path).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1200);
            });
          }}
        >
          <Copy size={12} />
        </button>
        {matches.length > 0 ? (
          <label className="thread-file-open-with">
            <span className="thread-file-open-with-label">Open with</span>
            <select
              aria-label="Open with"
              data-testid="thread-file-open-with"
              value={selectedKey}
              onChange={(event) => onSelect(event.target.value)}
            >
              <option value="host">Host preview</option>
              {matches.map((row) => (
                <option key={fileOpenerKey(row)} value={fileOpenerKey(row)}>
                  {row.title}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
    </header>
  );
}

export function ThreadFilePreviewTab({
  threadId,
  path,
  openerKey,
  projectId,
  storage = false
}: {
  threadId?: string;
  path: string;
  openerKey?: string | null;
  projectId?: string | null;
  storage?: boolean;
}) {
  const [override, setOverride] = useState<string | null>(openerKey ?? null);
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const openers = useSyncExternalStore(subscribePluginSlots, listFileOpeners, listFileOpeners);
  const opener = resolveFileOpener(path, openers, override);
  const OpenerComponent = opener?.component;
  const matches = matchingFileOpeners(path, openers);

  useEffect(() => {
    let cancelled = false;
    const hostReader = storage
      ? product.threads.storageContent
      : threadId
        ? product.threads.hostFileContent
        : undefined;
    void loadFilePreview(
      product.fs.readFile,
      hostReader,
      threadId,
      path,
      {
        skipLocal: storage ? true : undefined,
        readDataUrl: typeof product.fs.readDataUrl === 'function'
          ? product.fs.readDataUrl
          : undefined
      }
    ).then((result) => {
      applyPreviewResult(cancelled, result, setError, setContent);
    });
    return () => { cancelled = true; };
  }, [path, storage, threadId]);

  const hostPreview = (
    <ThreadFilePreviewView
      path={path}
      content={content}
      error={error}
      threadId={threadId}
      projectId={projectId}
    />
  );
  const chrome = (
    <ThreadFilePreviewChrome
      path={path}
      matches={matches}
      selectedKey={opener ? fileOpenerKey(opener) : 'host'}
      onSelect={(next) => {
        setOverride(next);
        const extension = fileExtensionOf(path);
        if (extension) writeFileOpenerPin(extension, next);
      }}
    />
  );
  const preview = !opener || !OpenerComponent ? (
    <div className="thread-file-preview-host">
      {chrome}
      {hostPreview}
    </div>
  ) : (
    <div className="thread-file-preview-host">
      {chrome}
      <PluginSlotBoundary pluginId={opener.pluginId} generation={opener.generation}>
        <OpenerComponent
          pluginId={opener.pluginId}
          path={path}
          source={{
            kind: storage ? 'thread-storage' : 'workspace',
            threadId: threadId ?? null,
            environmentId: null,
            projectId: projectId ?? null
          }}
          experimental_Original={() => hostPreview}
        />
      </PluginSlotBoundary>
    </div>
  );
  return (
    <SecondaryPanelSelectionActions threadId={threadId}>
      {preview}
    </SecondaryPanelSelectionActions>
  );
}
