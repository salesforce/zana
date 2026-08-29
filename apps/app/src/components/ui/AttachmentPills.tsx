import { FileText, X } from 'lucide-react';
import { attachmentName } from '../../lib/attachments.js';

/** Shared attachment display for composer-style inputs. Upload and launch policy
 * remain with the caller; this component only renders removable file pills. */
export function AttachmentPills({
  paths,
  onRemove
}: {
  paths: readonly string[];
  onRemove: (path: string) => void;
}) {
  if (paths.length === 0) return null;
  return (
    <div className="ui-command-attachments" aria-label="Attached files">
      {paths.map((path) => {
        const name = attachmentName(path);
        return (
          <span key={path} className="ui-command-attachment-chip" title={path}>
            <FileText size={14} aria-hidden="true" />
            <span className="ui-command-attachment-name">{name}</span>
            <button type="button" onClick={() => onRemove(path)} aria-label={`Remove ${name}`}>
              <X size={13} aria-hidden="true" />
            </button>
          </span>
        );
      })}
    </div>
  );
}
