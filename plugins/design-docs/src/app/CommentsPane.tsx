import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Markdown } from '@zana-ai/zcc-plugin-sdk/app';
import { Check, ChevronDown, ChevronRight, MessageSquare, Reply, RotateCcw, Trash2, X } from 'lucide-react';
import type { DesignDocComment, DesignDocDetail } from '../shared/contract.js';
import { MAX_COMMENT_LENGTH } from '../shared/limits.js';
import { errorMessage, toast, useApi } from './api.js';
import { usePersistentState } from './hooks.js';
import { ActorLabel, ConfirmDialog, EmptyState, IconButton, TimeAgo, type ConfirmRequest } from './ui.js';

/** A passage selected in the preview, waiting to be commented on. */
export interface PendingQuote {
  /** The file it was selected in; the comment anchors there even after switching files. */
  path: string | null;
  text: string;
}

const isSend = (event: KeyboardEvent<HTMLTextAreaElement>) => event.key === 'Enter' && (event.metaKey || event.ctrlKey);

function ReplyComposer({ onSend, onCancel }: { onSend(body: string): Promise<boolean>; onCancel(): void }) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async () => {
    const text = body.trim();
    if (!text || busy) return;
    setBusy(true);
    const sent = await onSend(text);
    setBusy(false);
    if (sent) setBody('');
  };
  return (
    <div className="dd-reply-composer">
      <textarea
        className="dd-input dd-composer-input"
        placeholder="Reply… agents see the whole thread"
        aria-label="Reply"
        value={body}
        maxLength={MAX_COMMENT_LENGTH}
        rows={2}
        autoFocus
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          if (isSend(event)) {
            event.preventDefault();
            void send();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            onCancel();
          }
        }}
      />
      <div className="dd-composer-actions">
        <span className="dd-editor-hint">⌘↵ to send · Esc to cancel</span>
        <span className="dd-reply-buttons">
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn primary" disabled={!body.trim() || busy} onClick={() => void send()}>
            Reply
          </button>
        </span>
      </div>
    </div>
  );
}

function CommentCard({
  comment,
  fileGone,
  now,
  onToggle,
  onDelete,
  onDeleteReply,
  onReply,
  onFocus
}: {
  comment: DesignDocComment;
  /** Its file was deleted; the comment stays but cannot jump there. */
  fileGone: boolean;
  now: number;
  onToggle(): void;
  onDelete(): void;
  onDeleteReply(replyId: string): void;
  /** Resolves true once the reply is saved. */
  onReply(body: string): Promise<boolean>;
  onFocus?(): void;
}) {
  const resolved = comment.status === 'resolved';
  const [replying, setReplying] = useState(false);
  return (
    <article className={`dd-comment${resolved ? ' dd-comment-resolved' : ''}`}>
      <header className="dd-comment-head">
        <ActorLabel actor={comment.author} />
        <TimeAgo at={comment.createdAt} now={now} />
        <span className="dd-spacer" />
        <IconButton icon={Reply} label="Reply" onClick={() => setReplying(true)} size={13} />
        <IconButton icon={resolved ? RotateCcw : Check} label={resolved ? 'Reopen' : 'Resolve'} onClick={onToggle} size={13} />
        <IconButton icon={Trash2} label="Delete comment" onClick={onDelete} danger size={13} />
      </header>
      {comment.path || comment.quote ? (
        <button
          type="button"
          className="dd-comment-anchor"
          onClick={onFocus}
          disabled={!onFocus}
          title={fileGone ? 'This file was deleted' : 'Show in the document'}
        >
          {comment.path ? (
            <span className={`dd-comment-path${fileGone ? ' dd-comment-path-gone' : ''}`}>
              {comment.path}
              {fileGone ? ' (deleted)' : ''}
            </span>
          ) : null}
          {comment.quote ? <span className="dd-comment-quote">{comment.quote}</span> : null}
        </button>
      ) : null}
      <div className="dd-comment-body">
        <Markdown content={comment.body} />
      </div>
      {comment.replies.length ? (
        <ol className="dd-replies" aria-label="Replies">
          {comment.replies.map((reply) => (
            <li key={reply.id} className="dd-reply">
              <header className="dd-comment-head">
                <ActorLabel actor={reply.author} />
                <TimeAgo at={reply.createdAt} now={now} />
                <span className="dd-spacer" />
                <IconButton icon={Trash2} label="Delete reply" onClick={() => onDeleteReply(reply.id)} danger size={12} />
              </header>
              <div className="dd-comment-body">
                <Markdown content={reply.body} />
              </div>
            </li>
          ))}
        </ol>
      ) : null}
      {replying ? (
        <ReplyComposer
          onCancel={() => setReplying(false)}
          onSend={async (body) => {
            const sent = await onReply(body);
            if (sent) setReplying(false);
            return sent;
          }}
        />
      ) : null}
    </article>
  );
}

export function CommentsPane({
  doc,
  activePath,
  now,
  pendingQuote,
  onClearQuote,
  draft: body,
  onDraft: setBody,
  onFocusComment
}: {
  doc: DesignDocDetail;
  activePath: string | null;
  now: number;
  pendingQuote: PendingQuote | null;
  onClearQuote(): void;
  /** The new-comment text, owned by the doc view so it outlives this pane. */
  draft: string;
  onDraft(value: string): void;
  onFocusComment(comment: DesignDocComment): void;
}) {
  const api = useApi();
  const [scope, setScope] = usePersistentState<'file' | 'all'>('comments-scope', 'all');
  const [showResolved, setShowResolved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
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

  const run = async (action: () => Promise<unknown>, failure: string): Promise<boolean> => {
    try {
      await action();
      return true;
    } catch (error) {
      toast(`${failure}: ${errorMessage(error)}`, 'error');
      return false;
    }
  };
  const anchorPath = pendingQuote ? pendingQuote.path : activePath;

  const submit = async () => {
    const text = body.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      await api.addComment(doc.id, {
        body: text,
        ...(anchorPath ? { path: anchorPath } : {}),
        ...(pendingQuote ? { quote: pendingQuote.text } : {})
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
    if (isSend(event)) {
      event.preventDefault();
      void submit();
    }
  };

  const paths = useMemo(() => new Set(doc.files.map((file) => file.path)), [doc.files]);
  const card = (comment: DesignDocComment) => {
    const fileGone = !!comment.path && !paths.has(comment.path);
    return (
      <CommentCard
        key={comment.id}
        comment={comment}
        fileGone={fileGone}
        now={now}
        onToggle={() =>
          void run(
            () => api.setCommentStatus(doc.id, comment.id, comment.status === 'open' ? 'resolved' : 'open'),
            'Could not update the comment'
          )
        }
        onDelete={() =>
          setConfirm({
            title: 'Delete comment',
            body: comment.replies.length
              ? `Delete this comment and its ${comment.replies.length === 1 ? 'reply' : `${comment.replies.length} replies`}? This cannot be undone.`
              : 'Delete this comment? This cannot be undone.',
            confirmLabel: 'Delete',
            danger: true,
            run: () => void run(() => api.deleteComment(doc.id, comment.id), 'Could not delete the comment')
          })
        }
        onDeleteReply={(replyId) => void run(() => api.deleteComment(doc.id, replyId), 'Could not delete the reply')}
        onReply={(text) => run(() => api.replyToComment(doc.id, comment.id, text), 'Could not reply')}
        onFocus={!fileGone && (comment.quote || comment.path) ? () => onFocusComment(comment) : undefined}
      />
    );
  };

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
            <span className="dd-comment-quote">{pendingQuote.text}</span>
            <IconButton icon={X} label="Remove quote" onClick={onClearQuote} size={12} />
          </div>
        ) : null}
        <textarea
          ref={inputRef}
          className="dd-input dd-composer-input"
          placeholder={anchorPath ? `Comment on ${anchorPath}… agents see open comments` : 'Leave a comment…'}
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
      {confirm ? <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} /> : null}
    </div>
  );
}
