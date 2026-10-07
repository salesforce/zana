import { MarkdownContent } from '../../MarkdownContent.js';
import type { ReviewComment as Comment } from '../../markdown-review-comments.js';
import { isOpenableWorkspaceRelPath, openWorkspaceFileForThread } from '../secondary-panel/useThreadOpenFileSignal.js';
import './ReviewComment.css';

export function ReviewComment({ comment, threadId, projectId, filePathHints }: {
  comment: Comment;
  threadId?: string;
  projectId?: string | null;
  filePathHints?: readonly string[];
}) {
  const location = `${comment.file}${comment.lines ? `:${comment.lines}` : ''}`;
  const openable = threadId && isOpenableWorkspaceRelPath(comment.file);
  return (
    <aside className="thread-review-comment" data-testid="thread-review-comment" aria-label={comment.title}>
      <div className="thread-review-comment-heading">
        {comment.priority ? <span className="thread-review-comment-priority" data-priority={comment.priority}>{comment.priority}</span> : null}
        <strong>{comment.title}</strong>
      </div>
      {comment.file ? (
        openable ? (
          <button type="button" className="thread-review-comment-location" title={location}
            aria-label={`Preview ${location}`}
            onClick={() => openWorkspaceFileForThread(threadId, comment.file, comment.lineNumber)}>
            {location}
          </button>
        ) : <span className="thread-review-comment-location">{location}</span>
      ) : null}
      {comment.body ? <MarkdownContent text={comment.body} threadId={threadId} projectId={projectId} threadMentions filePathHints={filePathHints} /> : null}
    </aside>
  );
}
