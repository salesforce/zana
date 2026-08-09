import { Modal } from './Modal';
import { MarkdownContent } from './MarkdownContent';
import { useWhatsNew } from '../store';

/**
 * "What's New" modal — renders the curated `docs/releases/<version>.md` notes
 * in-app. Shown once on the first launch after an update (the boot
 * `consumeWhatsNew` pull in the store) covering every version the user missed,
 * and on demand from Settings → About (`openWhatsNewAll`).
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

  if (!open || notes.length === 0) return null;

  const title = toVersion ? `What’s new in v${toVersion}` : 'What’s new';

  return (
    <Modal
      title={title}
      onClose={close}
      className="whats-new-modal"
      footer={
        <button type="button" className="settings-btn primary" onClick={close}>
          Got it
        </button>
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
            <MarkdownContent text={note.markdown} />
            {i < notes.length - 1 && <hr className="whats-new-divider" />}
          </section>
        ))}
      </div>
    </Modal>
  );
}
