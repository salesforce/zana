import { useEffect, useState } from 'react';
import type { TimelineViewWorkRow } from '@zana-ai/zcc-thread-view';
import { formatDiffStatsText } from '@zana-ai/zcc-thread-view';
import { product } from '../../../lib/product-client.js';
import { imagePreviewSrc } from './work-row-helpers.js';

function TerminalOutput({
  command,
  source,
  output,
  exitCode,
  streaming
}: {
  command?: string;
  source?: string | null;
  output: string;
  exitCode?: number | null;
  streaming?: boolean;
}) {
  return (
    <div className="thread-terminal-output" data-streaming={streaming ? 'true' : undefined}>
      {command ? <div className="thread-terminal-cmd">$ {command}</div> : null}
      {source ? <div className="thread-terminal-meta">source: {source}</div> : null}
      {output ? <pre className="thread-timeline-work-body">{output}</pre> : null}
      {exitCode != null ? <div className="thread-terminal-meta">exit {exitCode}</div> : null}
    </div>
  );
}

function ToolCallDetail({
  toolName,
  args,
  output,
  streaming
}: {
  toolName: string;
  args: unknown;
  output: string;
  streaming?: boolean;
}) {
  const serialized = args == null ? '' : typeof args === 'string' ? args : JSON.stringify(args, null, 2);
  return (
    <div className="thread-tool-detail" data-streaming={streaming ? 'true' : undefined}>
      <div className="thread-terminal-meta">{toolName}</div>
      {serialized ? <pre className="thread-timeline-work-body">{serialized}</pre> : null}
      {output ? <pre className="thread-timeline-work-body">{output}</pre> : null}
    </div>
  );
}

function FileChangeBody({
  change,
  stderr,
  onOpenDiff
}: {
  change: {
    path: string;
    diff?: string | null;
    diffStats?: { added: number; removed: number };
  };
  stderr?: string | null;
  onOpenDiff?: (path: string) => void;
}) {
  const tally = change.diffStats
    ? formatDiffStatsText(change.diffStats) ?? `+${change.diffStats.added} −${change.diffStats.removed}`
    : '';
  return (
    <div className="thread-file-change-body">
      <div className="thread-file-change-meta">
        {onOpenDiff ? (
          <button
            type="button"
            className="thread-file-change-path"
            onClick={() => onOpenDiff(change.path)}
          >
            {change.path}
          </button>
        ) : (
          <span className="thread-file-change-path">{change.path}</span>
        )}
        {tally ? <span className="thread-timeline-title-deco">{tally}</span> : null}
      </div>
      {change.diff ? <pre className="thread-timeline-work-body thread-file-hunk">{change.diff}</pre> : null}
      {stderr ? <pre className="thread-timeline-work-body is-danger">{stderr}</pre> : null}
    </div>
  );
}

function WorkflowBody({ row }: { row: Extract<TimelineViewWorkRow, { workKind: 'workflow' }> }) {
  const phases = row.workflow?.phases ?? [];
  const agents = row.workflow?.agents ?? [];
  return (
    <div className="thread-workflow-body">
      {row.description ? <p className="thread-workflow-summary">{row.description}</p> : null}
      {phases.length > 0 ? (
        <ol className="thread-workflow-phases">
          {phases.map((phase) => (
            <li key={phase.index}>{phase.title}</li>
          ))}
        </ol>
      ) : null}
      {agents.length > 0 ? (
        <ul className="thread-workflow-agents">
          {agents.map((agent) => (
            <li key={agent.index} data-state={agent.state}>
              {agent.label} · {agent.state}
            </li>
          ))}
        </ul>
      ) : null}
      {row.summary ? <p className="thread-workflow-summary">{row.summary}</p> : null}
      {row.error ? <p className="thread-workflow-error">{row.error}</p> : null}
    </div>
  );
}

function QuestionBody({
  row
}: {
  row: Extract<TimelineViewWorkRow, { workKind: 'question' }>;
}) {
  const prompts = row.questions.map((question) => question.prompt).filter(Boolean);
  const answers = row.answers
    ? Object.values(row.answers).flatMap((answer) => [
        ...answer.selected,
        ...(answer.freeText ? [answer.freeText] : [])
      ]).filter(Boolean)
    : [];
  return (
    <div className="thread-question-body" data-lifecycle={row.lifecycle} data-testid="thread-question-row">
      {prompts.map((prompt) => (
        <p key={prompt} className="thread-question-prompt">{prompt}</p>
      ))}
      {answers.length > 0 ? (
        <p className="thread-question-answer">{answers.join(', ')}</p>
      ) : row.lifecycle === 'pending' ? (
        <p className="thread-terminal-meta">Waiting for an answer</p>
      ) : null}
    </div>
  );
}

function ApprovalBody({ row }: { row: Extract<TimelineViewWorkRow, { workKind: 'approval' }> }) {
  const waiting = row.lifecycle === 'waiting' || row.lifecycle === 'pending';
  const denied = row.lifecycle === 'denied';
  return (
    <div
      className="thread-approval-body"
      data-lifecycle={row.lifecycle}
      data-testid="thread-approval-row"
    >
      <p>
        {waiting ? 'Waiting for approval' : denied ? 'Denied' : row.lifecycle}
        {row.approvalKind === 'file-edit' ? ' · file edit' : ' · permission'}
      </p>
      {row.target.toolName ? <p className="thread-terminal-meta">{row.target.toolName}</p> : null}
    </div>
  );
}

function ImageViewBody({
  path,
  threadId
}: {
  path: string;
  threadId?: string;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!threadId) return;
    let cancelled = false;
    void product.threads.hostFileContent(threadId, path).then((file) => {
      if (cancelled) return;
      const preview = imagePreviewSrc(file);
      if (preview) setSrc(preview);
    }).catch(() => {
      if (!cancelled) setFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [path, threadId]);
  if (!src || failed) {
    return <p className="thread-image-stub" data-testid="thread-image-stub">{path}</p>;
  }
  return (
    <img
      className="thread-image-thumb"
      src={src}
      alt={`Viewed image: ${path}`}
      onError={() => setFailed(true)}
    />
  );
}

export function WorkRowBody({
  row,
  threadId,
  onOpenDiff
}: {
  row: TimelineViewWorkRow;
  threadId?: string;
  onOpenDiff?: (path: string) => void;
}) {
  switch (row.workKind) {
    case 'command':
      return (
        <TerminalOutput
          command={row.command}
          source={row.source}
          output={row.output}
          exitCode={row.exitCode}
          streaming={row.status === 'pending'}
        />
      );
    case 'tool':
      return (
        <ToolCallDetail
          toolName={row.toolName}
          args={row.toolArgs}
          output={row.output}
          streaming={row.status === 'pending'}
        />
      );
    case 'file-change':
      return (
        <FileChangeBody
          change={row.change}
          stderr={row.stderr}
          onOpenDiff={onOpenDiff}
        />
      );
    case 'workflow':
      return <WorkflowBody row={row} />;
    case 'question':
      return <QuestionBody row={row} />;
    case 'approval':
      return <ApprovalBody row={row} />;
    case 'image-view':
      return <ImageViewBody path={row.path} threadId={threadId} />;
    case 'web-search':
    case 'web-fetch':
    case 'delegation':
      return null;
    default:
      return null;
  }
}
