import { useEffect, useState } from 'react';
import { FolderPlus, X } from 'lucide-react';
import { TRUSTED_PREVIEW_FOLDERS_MAX, type AppConfig } from '@zana-ai/zcc-domain/product';
import { product } from '../../lib/product-client.js';
import { Section, SettingsActionRow } from '@/components/settings/FormFields';

/**
 * Folders the user trusts for read-only file Preview. Only the native chooser
 * adds a folder; the renderer never types or submits a path to trust, and
 * main re-validates everything it stores. Remove only drops the list entry.
 */
export function TrustedPreviewFoldersSection({ config }: { config: Pick<AppConfig, 'trustedPreviewFolders'> }) {
  const [folders, setFolders] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Authoritative config updates (another window, a reload) supersede the optimistic local list.
  useEffect(() => setFolders(null), [config.trustedPreviewFolders]);
  const shown = folders ?? config.trustedPreviewFolders ?? [];
  const atCap = shown.length >= TRUSTED_PREVIEW_FOLDERS_MAX;

  const run = async (action: () => Promise<{ config: AppConfig | null; error?: string }>) => {
    setBusy(true);
    setError(null);
    try {
      const result = await action();
      if (result.error) setError(result.error);
      else if (result.config) setFolders(result.config.trustedPreviewFolders ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update trusted folders.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      anchorId="trusted-preview-folders"
      searchId="global.trusted-preview-folders-intro"
      title="Trusted Preview Folders"
      help="Thread Preview can open files in these folders, read-only, even when they are outside a project. This applies only to this local desktop; remote threads and machines do not use this list. Removing a folder only stops previews and never deletes files."
    >
      {shown.length === 0 ? (
        <p className="settings-help settings-help--muted">No trusted folders. Only project and Zana-owned files can be previewed.</p>
      ) : (
        <ul className="settings-list" data-testid="trusted-preview-folders">
          {shown.map((root) => (
            <li key={root} className="settings-list-row">
              <code title={root}>{root}</code>
              <button
                type="button"
                className="settings-btn"
                aria-label={`Remove ${root}`}
                disabled={busy}
                onClick={() => void run(async () => ({ config: await product.config.removeTrustedPreviewFolder(root) }))}
              >
                <X size={14} aria-hidden="true" />
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <SettingsActionRow
        searchId="global.trusted-preview-folders-add"
        label="Trust a folder"
        help={atCap ? `Limit of ${TRUSTED_PREVIEW_FOLDERS_MAX} folders reached. Remove one to add another.` : 'Choose a folder in the system dialog.'}
      >
        <button
          type="button"
          className="settings-btn"
          disabled={busy || atCap}
          onClick={() => void run(() => product.config.addTrustedPreviewFolder())}
        >
          <FolderPlus size={14} aria-hidden="true" />
          Add folder
        </button>
      </SettingsActionRow>
      {error ? <p className="settings-help" role="alert">{error}</p> : null}
    </Section>
  );
}
