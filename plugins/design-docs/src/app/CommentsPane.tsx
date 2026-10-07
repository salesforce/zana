import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Markdown } from '@zana-ai/zcc-plugin-sdk/app';
import { Check, ChevronDown, ChevronRight, MessageSquare, RotateCcw, Trash2, X } from 'lucide-react';
import type { DesignDocComment, DesignDocDetail } from '../shared/contract.js';
import { MAX_COMMENT_LENGTH } from '../shared/limits.js';
import { errorMessage, toast, useApi } from './api.js';
import { usePersistentState } from './hooks.js';
import { ActorLabel, EmptyState, IconButton, TimeAgo } from './ui.js';

function CommentCard({
  comment,
  now,
  onToggle,
  onDelete,
  onFocus
}: {
  comment: DesignDocComment;
  now: number;
  onToggle(): void;
  onDelete(): void;
  onFocus?(): void;
}) {
  const resolved = comment.status === 'resolved';
  return (
    <article className={`dd-comment${resolved ? ' dd-comment-resolved' : ''}`}>
      <header className="dd-comment-head">
        <ActorLabel actor={comment.author} />
        <TimeAgo at={comment.createdAt} now={now} />
        <span className="dd-spacer" />
        <IconButton icon={resolved ? RotateCcw : Check} label={resolved ? 'Reopen' : 'Resolve'} onClick={onToggle} size={13} />
        <IconButton icon={Trash2} label="Delete comment" onClick={onDelete} danger size={13} />
      </header>
      {comment.path || comment.quote ? (
        <button type="button" className="dd-comment-anchor" onClick={onFocus} disabled={!onFocus} title="Show in the document">
          {comment.path ? <span className="dd-comment-path">{comment.path}</span> : null}
          {comment.quote ? <span className="dd-comment-quote">{comment.quote}</span> : null}
        </button>
      ) : null}
      <div className="dd-comment-body">
        <Markdown content={comment.body} />
      </div>
    </article>
  );
}

export function CommentsPane({
  doc,
  activePath,
  now,
  pendingQuote,
  onClearQuote,
  onFocusComment
}: {
  doc: DesignDocDetail;
  activePath: string | null;
  now: number;
  pendingQuote: string | null;
  onClearQuote(): void;
  onFocusComment(comment: DesignDocComment): void;
}) {
  const api = useApi();
  const [scope, setScope] = usePersistentState<'file' | 'all'>('comments-scope', 'all');
  const [showResolved, setShowResolved] = useState(false);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (pendingQuote) inputRef.current?.focus();
  }, [pendingQuote]);

  const visible = useMemo(
    () => doc.comments.filter((comment) => scope === 'all' || !comment.path || comment.path === activePath),
    [doc.comments, scope, activePath]
  );
  const open = visible.filter((comment) => comment.status === 'open');
  const resolved = visible.filter((comment) => comment.status === 'resolved');

  const run = async (action: () => Promise<unknown>, failure: string) => {
    try {
      await action();
    } catch (error) {
      toast(`${failure}: ${errorMessage(error)}`, 'error');
    }
  };

  const submit = async () => {
    const text = body.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      await api.addComment(doc.id, {
        body: text,
        ...(activePath ? { path: activePath } : {}),
        ...(pendingQuote ? { quote: pendingQuote } : {})
      });
      setBody('');
      onClearQuote();
    } catch (error) {
      toast(`Could not add the comment: ${errorMessage(error)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void submit();
    }
  };

  const card = (comment: DesignDocComment) => (
    <CommentCard
      key={comment.id}
      comment={comment}
      now={now}
      onToggle={() =>
        void run(
          () => api.setCommentStatus(doc.id, comment.id, comment.status === 'open' ? 'resolved' : 'open'),
          'Could not update the comment'
        )
      }
      onDelete={() => void run(() => api.deleteComment(doc.id, comment.id), 'Could not delete the comment')}
      onFocus={comment.quote || comment.path ? () => onFocusComment(comment) : undefined}
    />
  );

  return (
    <div className="dd-rail-pane dd-comments">
      <div className="dd-rail-toolbar">
        <div className="dd-segmented" role="group" aria-label="Comment scope">
          <button type="button" className={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')}>
            All files
          </button>
          <button type="button" className={scope === 'file' ? 'on' : ''} onClick={() => setScope('file')} disabled={!activePath}>
            This file
          </button>
        </div>
      </div>
      <div className="dd-rail-scroll">
        {open.length === 0 ? (
          <EmptyState icon={MessageSquare} title="No open comments">
            Select text in the document to comment on it, or ask an agent for a review.
          </EmptyState>
        ) : (
          open.map(card)
        )}
        {resolved.length ? (
          <div className="dd-resolved">
            <button type="button" className="dd-disclosure" onClick={() => setShowResolved(!showResolved)}>
              {showResolved ? <ChevronDown size={13} aria-hidden /> : <ChevronRight size={13} aria-hidden />}
              Resolved ({resolved.length})
            </button>
            {showResolved ? resolved.map(card) : null}
          </div>
        ) : null}
      </div>
      <div className="dd-composer">
        {pendingQuote ? (
          <div className="dd-composer-quote">
            <span className="dd-comment-quote">{pendingQuote}</span>
            <IconButton icon={X} label="Remove quote" onClick={onClearQuote} size={12} />
          </div>
        ) : null}
        <textarea
          ref={inputRef}
          className="dd-input dd-composer-input"
          placeholder={activePath ? `Comment on ${activePath}… agents see open comments` : 'Leave a comment…'}
          value={body}
          maxLength={MAX_COMMENT_LENGTH}
          rows={3}
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="dd-composer-actions">
          <span className="dd-editor-hint">⌘↵ to send</span>
          <button type="button" className="btn primary" disabled={!body.trim() || busy} onClick={() => void submit()}>
            Comment
          </button>
        </div>
      </div>
    </div>
  );
}
