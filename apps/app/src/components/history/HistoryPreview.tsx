import type { ReactNode } from 'react';
import type { ConversationTranscript } from '@zana-ai/zcc-domain/product';
import { HistoryContext } from './HistoryContext.js';

export function HistoryPreview({ selection, transcript, error, notice, truncatedNotice, actions }: {
  selection: { id: string; title: string; harnessId: string; harnessName?: string; projectName?: string; meta: string } | null;
  transcript: ConversationTranscript | null;
  error?: string;
  notice?: ReactNode;
  truncatedNotice: string;
  actions?: ReactNode;
}) {
  return <section className="history-transcript" aria-label="Saved conversation">
    {!selection ? <p className="history-empty-preview">Select a conversation to read it before continuing.</p> : <div key={selection.id} className="history-preview-content">
      <div className="history-transcript-heading">
        <h3>{selection.title}</h3>
        <HistoryContext harnessId={selection.harnessId} harnessName={selection.harnessName} projectName={selection.projectName} />
        <span className="history-meta">{selection.meta}</span>
        <div className="history-preview-actions">{actions}</div>
      </div>
      <div className="history-transcript-body" tabIndex={0} aria-label="Conversation messages">
        {notice}
        {error ? <p role="alert">{error}</p> : !transcript && <p role="status">Loading transcript…</p>}
        {transcript?.unavailableReason && <p>{transcript.unavailableReason}</p>}
        {transcript?.messages.map((message, i) => <div className="history-message" key={i}>
          <strong>{message.role === 'user' ? 'You' : 'Assistant'}</strong><div>{message.text}</div>
        </div>)}
        {transcript?.truncated && <p>{truncatedNotice}</p>}
        {transcript && !transcript.messages.length && !transcript.unavailableReason && <p>No text messages were saved in this conversation.</p>}
      </div>
    </div>}
  </section>;
}
