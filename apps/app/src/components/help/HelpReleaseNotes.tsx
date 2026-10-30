import { useEffect, useState } from 'react';
import { ArrowRight, ChevronRight, FileText } from 'lucide-react';
import type { ReleaseNote } from '@zana-ai/zcc-domain/product';
import { product } from '../../lib/product-client.js';
import { MarkdownContent } from '../MarkdownContent.js';
import { Modal } from '../Modal.js';
import { ReleaseNoteVideo } from '../ReleaseNoteVideo.js';

/** Read only bundled, published notes through the existing product API. */
export function HelpReleaseNotesSection({ onOpen }: { onOpen: (notes: ReleaseNote[]) => void }) {
  const [notes, setNotes] = useState<ReleaseNote[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    setNotes(null);
    void product.updates.getReleaseNotes().then((result) => {
      if (!cancelled) setNotes(result);
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [attempt]);
  const latest = notes?.[0];

  return (
    <section aria-label="Release notes">
      <div className="help-menu-heading">
        <span>Release notes</span>
        <button type="button" className="help-menu-all" disabled={!latest} onClick={() => onOpen(notes!)}>
          All releases <ArrowRight size={12} aria-hidden="true" />
        </button>
      </div>
      {latest ? (
        <button type="button" className="help-menu-row help-menu-release" onClick={() => onOpen(notes!)}>
          <FileText size={16} aria-hidden="true" />
          <span className="help-menu-release-copy">
            <span className="help-menu-release-title">Zana {latest.version}<span className="help-menu-release-badge">Latest</span></span>
            <small>Features, improvements and fixes</small>
          </span>
          <ChevronRight size={14} aria-hidden="true" />
        </button>
      ) : (
        <div className="help-menu-release-status" role="status">
          {failed ? <>Couldn’t load release notes. <button type="button" className="help-menu-all" onClick={() => setAttempt((value) => value + 1)}>Retry</button></>
            : notes ? 'No release notes available.' : 'Loading release notes…'}
        </div>
      )}
    </section>
  );
}

/** Version selection keeps older releases available without one long page. */
export function ReleaseNotesBrowser({ notes, onClose }: { notes: ReleaseNote[]; onClose: () => void }) {
  const [version, setVersion] = useState(notes[0].version);
  const selected = notes.find((note) => note.version === version)!;
  return (
    <Modal title="Release notes" onClose={onClose} className="help-releases-modal"
      bodyClassName="help-releases-body"
      footer={<button type="button" className="settings-btn primary" onClick={onClose}>Done</button>}>
      <nav className="help-releases-nav" aria-label="Releases">
        {notes.map((note, index) => (
          <button key={note.version} type="button" aria-current={note.version === version ? 'true' : undefined}
            onClick={() => setVersion(note.version)}>
            <span>{note.version}</span>{index === 0 && <small>Latest</small>}
          </button>
        ))}
      </nav>
      <article key={version} className="help-releases-content" aria-label={`Release ${version}`} tabIndex={0}>
        <ReleaseNoteVideo version={selected.version} />
        <MarkdownContent text={selected.markdown} />
      </article>
    </Modal>
  );
}
