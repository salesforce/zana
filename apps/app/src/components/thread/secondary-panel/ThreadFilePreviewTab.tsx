import { useEffect, useState, useSyncExternalStore } from 'react';
import { product } from '../../../lib/product-client.js';
import { PluginSlotBoundary } from '../../../plugins/PluginSlotBoundary.js';
import { listFileOpeners, subscribePluginSlots } from '../../../plugins/plugin-slots.js';
import {
  fileOpenerKey,
  matchingFileOpeners,
  resolveFileOpener
} from '../../../plugins/plugin-slot-resolvers.js';
import { SecondaryPanelSelectionActions } from './SecondaryPanelSelectionActions.js';
import { applyPreviewResult, loadFilePreview, previewKind } from './threadSecondaryPanelLogic.js';

export function ThreadFilePreviewView({
  path,
  content,
  error
}: {
  path: string;
  content: string;
  error: string | null;
}) {
  if (error) return <p className="thread-detail-empty">{error}</p>;
  if (previewKind(path, content) === 'image') {
    return <img className="thread-file-preview-image" src={content} alt={path} />;
  }
  return (
    <pre className="thread-file-preview" data-testid="thread-file-preview">
      {content}
    </pre>
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
  const [content, setContent] = useState<string>('Loading…');
  const [error, setError] = useState<string | null>(null);
  const openers = useSyncExternalStore(subscribePluginSlots, listFileOpeners, listFileOpeners);
  const opener = resolveFileOpener(path, openers, override);
  const OpenerComponent = opener?.component;

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
      storage ? { skipLocal: true } : undefined
    ).then((result) => {
      applyPreviewResult(cancelled, result, setError, setContent);
    });
    return () => { cancelled = true; };
  }, [path, storage, threadId]);

  const hostPreview = <ThreadFilePreviewView path={path} content={content} error={error} />;
  const matches = matchingFileOpeners(path, openers);
  const openWith = matches.length > 0 ? (
    <label className="thread-file-open-with">
      Open with
      <select
        aria-label="Open with"
        data-testid="thread-file-open-with"
        value={opener ? fileOpenerKey(opener) : 'host'}
        onChange={(event) => {
          setOverride(event.target.value);
        }}
      >
        <option value="host">Host preview</option>
        {matches.map((row) => (
          <option key={fileOpenerKey(row)} value={fileOpenerKey(row)}>
            {row.title}
          </option>
        ))}
      </select>
    </label>
  ) : null;
  const preview = !opener || !OpenerComponent ? (
    <div className="thread-file-preview-host">
      {openWith}
      {hostPreview}
    </div>
  ) : (
    <div className="thread-file-preview-host">
      {openWith}
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
