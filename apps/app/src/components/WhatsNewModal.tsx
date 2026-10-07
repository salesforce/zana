import { Modal } from './Modal.js';
import { MarkdownContent } from './MarkdownContent.js';
import { ReleaseNoteVideo } from './ReleaseNoteVideo.js';
import { useUpdates, useWhatsNew } from '../store.js';
import { product } from '../lib/product-client.js';

/**
 * "What's New" modal — renders the curated `docs/releases/<version>.md` notes
 * in-app. Shown once on the first launch after an update (the boot
 * `consumeWhatsNew` pull in the store) covering every version the user missed,
 * on demand from Settings → About (`openWhatsNewAll`), and from the update
 * banner as a PREVIEW of a not-yet-installed version (notes from the release
 * feed) — then the footer offers the banner's install action.
 *
 * One collapsible-free section per version, newest first, each rendered through
 * the shared {@link MarkdownContent} pipeline (react-markdown + gfm + highlight)
 * so it matches how inbox reports and library docs render. Mounted once near the
 * app root; it self-gates on `useWhatsNew().open`, so there's nothing to render
 * when closed.
 */
export function WhatsNewModal() {
  const open = useWhatsNew((s) => s.open);
  const notes = useWhatsNew((s) => s.notes);
  const toVersion = useWhatsNew((s) => s.toVersion);
  const close = useWhatsNew((s) => s.close);
  const preview = useWhatsNew((s) => s.preview);
  const updateKind = useUpdates((s) => s.status.kind);

  if (!open || notes.length === 0) return null;

  const title = toVersion ? `What’s new in v${toVersion}` : 'What’s new';
  // Only offer the install action while the update is still actionable.
  const installAction = preview && (updateKind === 'available' || updateKind === 'downloaded') ? updateKind : null;

  return (
    <Modal
      title={title}
      onClose={close}
      className="whats-new-modal"
      footer={
        installAction ? (
          <>
            <button type="button" className="settings-btn" onClick={close}>
              Later
            </button>
            <button
              type="button"
              className="settings-btn primary"
              onClick={() => {
                close();
                if (installAction === 'downloaded') void product.updates.quitAndInstall();
                else void product.updates.download({ installNow: true });
              }}
            >
              {installAction === 'downloaded' ? 'Restart now' : 'Update now'}
            </button>
          </>
        ) : (
          <button type="button" className="settings-btn primary" onClick={close}>
            Got it
          </button>
        )
      }
    >
      <div className="whats-new-body">
        {notes.map((note, i) => (
          <section key={note.version} className="whats-new-release">
            {/* Only tag the version when we're showing more than one — a single
                release's own H1 already names it, so avoid a redundant chip. */}
            {notes.length > 1 && (
              <div className="whats-new-version-chip">v{note.version}</div>
            )}
            <ReleaseNoteVideo version={note.version} />
            <MarkdownContent text={note.markdown} />
            {i < notes.length - 1 && <hr className="whats-new-divider" />}
          </section>
        ))}
      </div>
    </Modal>
  );
}
