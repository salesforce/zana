import { useEffect, useMemo, useState } from 'react';
import type { TimelineViewWorkRow } from '@zana-ai/zcc-thread-view';
import { formatDiffStatsText } from '@zana-ai/zcc-thread-view';
import { MarkdownContent } from '../../MarkdownContent.js';
import { DiffViewer } from '../../DiffViewer.js';
import { product } from '../../../lib/product-client.js';
import { ExpandableLine } from './ExpandableLine.js';
import { ansiToHtml, stripAnsi } from './ansi-output.js';
import { imagePreviewSrc } from './work-row-helpers.js';
import { ThreadImageLightbox } from './ThreadImageLightbox.js';
import {
  isPluginRenderableWorkRow,
  PluginTimelineRendererBody
} from './PluginTimelineRendererBody.js';
import { dispatchThreadOpenFile } from '../secondary-panel/useThreadOpenFileSignal.js';
import { useTimelineWorkRowFullOutput } from './useTimelineWorkRowFullOutput.js';
import { ThreadOpenFilePreviewButton } from './TimelineTitleView.js';

function splitUnifiedDiff(diff: string): { original: string; modified: string } {
  const original: string[] = [];
  const modified: string[] = [];
  for (const line of diff.split('\n')) {
    if (
      line.startsWith('diff ')
      || line.startsWith('index ')
      || line.startsWith('---')
      || line.startsWith('+++')
      || line.startsWith('@@')
    ) {
      continue;
    }
    if (line.startsWith('-')) original.push(line.slice(1));
    else if (line.startsWith('+')) modified.push(line.slice(1));
    else {
      const body = line.startsWith(' ') ? line.slice(1) : line;
      original.push(body);
      modified.push(body);
    }
  }
  return { original: original.join('\n'), modified: modified.join('\n') };
}

function PresentationDetail({
  presentation,
  threadId
}: {
  presentation?: { detail?: string };
  threadId?: string;
}) {
  const detail = presentation?.detail?.trim();
  if (!detail) return null;
  return (
    <div className="thread-presentation-detail">
      <MarkdownContent text={detail} threadId={threadId} threadMentions />
    </div>
  );
}

function TerminalOutput({
  command,
  source,
  output,
  exitCode,
  streaming,
  previewTotalChars,
  previewState,
  onShowFull
}: {
  command?: string;
  source?: string | null;
  output: string;
  exitCode?: number | null;
  streaming?: boolean;
  previewTotalChars?: number;
  previewState?: string;
  onShowFull?: () => void;
}) {
  const commandText = command ? `$ ${command}` : '';
  const html = useMemo(() => ansiToHtml(output), [output]);
  return (
    <div
      className="thread-code-card thread-terminal-output"
      data-streaming={streaming ? 'true' : undefined}
    >
      {commandText ? (
        <ExpandableLine fullText={commandText}>{commandText}</ExpandableLine>
      ) : null}
      {source ? <div className="thread-terminal-meta">source: {source}</div> : null}
      {output ? (
        <pre
          className="thread-timeline-work-body thread-ansi-output"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : null}
      {exitCode != null ? <div className="thread-terminal-meta">exit {exitCode}</div> : null}
      {previewTotalChars != null ? (
        <div className="thread-output-preview-meta">
          Showing preview of {previewTotalChars.toLocaleString()} characters
          {previewState === 'error' || previewState === 'streaming-preview' || previewState === 'loading' ? (
            <button type="button" onClick={onShowFull} disabled={previewState === 'loading'}>
              {previewState === 'loading' ? 'Loading…' : 'Show full output'}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ToolCallDetail({
  toolName,
  args,
  output,
  streaming,
  previewTotalChars,
  previewState,
  onShowFull
}: {
  toolName: string;
  args: unknown;
  output: string;
  streaming?: boolean;
  previewTotalChars?: number;
  previewState?: string;
  onShowFull?: () => void;
}) {
  const serialized = args == null ? '' : typeof args === 'string' ? args : JSON.stringify(args, null, 2);
  return (
    <div
      className="thread-code-card thread-tool-detail"
      data-streaming={streaming ? 'true' : undefined}
    >
      <div className="thread-terminal-meta">{toolName}</div>
      {serialized ? <pre className="thread-timeline-work-body">{serialized}</pre> : null}
      {output ? <pre className="thread-timeline-work-body">{stripAnsi(output)}</pre> : null}
      {previewTotalChars != null ? (
        <div className="thread-output-preview-meta">
          Showing preview of {previewTotalChars.toLocaleString()} characters
          {previewState === 'error' || previewState === 'streaming-preview' || previewState === 'loading' ? (
            <button type="button" onClick={onShowFull} disabled={previewState === 'loading'}>
              {previewState === 'loading' ? 'Loading…' : 'Show full output'}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function CommandBody({ row }: { row: Extract<TimelineViewWorkRow, { workKind: 'command' }> }) {
  const full = useTimelineWorkRowFullOutput(row);
  return (
    <TerminalOutput
      command={row.command}
      source={row.source}
      output={full.output}
      exitCode={row.exitCode}
      streaming={row.status === 'pending'}
      previewTotalChars={row.outputPreview?.totalChars}
      previewState={full.state}
      onShowFull={full.retry}
    />
  );
}

function ToolBody({ row }: { row: Extract<TimelineViewWorkRow, { workKind: 'tool' }> }) {
  const full = useTimelineWorkRowFullOutput(row);
  return (
    <ToolCallDetail
      toolName={row.toolName}
      args={row.toolArgs}
      output={full.output}
      streaming={row.status === 'pending'}
      previewTotalChars={row.outputPreview?.totalChars}
      previewState={full.state}
      onShowFull={full.retry}
    />
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
  const sides = change.diff ? splitUnifiedDiff(change.diff) : null;
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
      {sides && (sides.original.length > 0 || sides.modified.length > 0) ? (
        <div className="thread-file-change-diff">
          <DiffViewer
            original={sides.original}
            modified={sides.modified}
            path={change.path}
            compact
            wrap
            fitContent
          />
        </div>
      ) : change.diff ? (
        <pre className="thread-timeline-work-body thread-file-hunk">{change.diff}</pre>
      ) : null}
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

function formatQuestionAnswers(
  questions: Extract<TimelineViewWorkRow, { workKind: 'question' }>['questions'],
  answers: Extract<TimelineViewWorkRow, { workKind: 'question' }>['answers']
): string[] {
  if (!answers) return [];
  return questions.flatMap((question) => {
    const answer = answers[question.id];
    if (!answer) return [];
    const selected = answer.selected.map((value) => {
      const option = question.options?.find((entry) => entry.value === value);
      return option?.label ?? value;
    });
    return [...selected, ...(answer.freeText ? [answer.freeText] : [])].filter(Boolean);
  });
}

function QuestionBody({
  row
}: {
  row: Extract<TimelineViewWorkRow, { workKind: 'question' }>;
}) {
  const prompts = row.questions.map((question) => question.prompt).filter(Boolean);
  const answers = formatQuestionAnswers(row.questions, row.answers);
  if (row.lifecycle === 'pending') return null;
  return (
    <div className="thread-question-body" data-lifecycle={row.lifecycle} data-testid="thread-question-row">
      {prompts.map((prompt) => (
        <p key={prompt} className="thread-question-prompt">{prompt}</p>
      ))}
      {answers.length > 0 ? (
        <p className="thread-question-answer">{answers.join(', ')}</p>
      ) : null}
    </div>
  );
}

function ApprovalBody(): null {
  return null;
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
  const [lightbox, setLightbox] = useState(false);
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
    <>
      <button type="button" className="thread-image-open" onClick={() => setLightbox(true)}>
        <img className="thread-image-thumb" src={src} alt={`Viewed image: ${path}`} onError={() => setFailed(true)} />
      </button>
      {lightbox ? (
        <ThreadImageLightbox src={src} alt={path} onClose={() => setLightbox(false)} />
      ) : null}
    </>
  );
}

function PlanStepsBody({
  row,
  threadId
}: {
  row: Extract<TimelineViewWorkRow, { workKind: 'plan-steps' }>;
  threadId?: string;
}) {
  return (
    <div className="thread-plan-steps-body">
      <PresentationDetail presentation={row.presentation} threadId={threadId} />
      {row.explanation ? <p className="thread-plan-steps-explanation">{row.explanation}</p> : null}
      <ul className="thread-plan-steps" data-testid="plan-steps-body">
        {row.steps.map((step, index) => (
          <li key={`${index}:${step.step}`} data-plan-step-status={step.status ?? 'pending'}>
            {step.step}
          </li>
        ))}
      </ul>
    </div>
  );
}

function HostWorkRowBody({
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
      return <CommandBody row={row} />;
    case 'tool':
      return <ToolBody row={row} />;
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
      return <ApprovalBody />;
    case 'image-view':
      return <ImageViewBody path={row.path} threadId={threadId} />;
    case 'file-read':
      return (
        <div className="thread-file-read-body">
          <PresentationDetail presentation={row.presentation} threadId={threadId} />
          <p className="thread-terminal-meta">{row.path}</p>
          {threadId ? (
            <ThreadOpenFilePreviewButton onClick={() => dispatchThreadOpenFile(threadId, row.path)} />
          ) : null}
          {row.cmd ? <pre className="thread-timeline-work-body">{row.cmd}</pre> : null}
        </div>
      );
    case 'search':
      return (
        <div className="thread-search-body">
          <PresentationDetail presentation={row.presentation} threadId={threadId} />
          <p className="thread-terminal-meta">
            {row.mode === 'list' ? row.path ?? 'files' : row.query || 'files'}
          </p>
          {row.cmd ? <pre className="thread-timeline-work-body">{row.cmd}</pre> : null}
        </div>
      );
    case 'plan-steps':
      return <PlanStepsBody row={row} threadId={threadId} />;
    case 'extension':
      return (
        <div className="thread-extension-body">
          <PresentationDetail presentation={row.presentation} threadId={threadId} />
        </div>
      );
    case 'web-search':
    case 'web-fetch':
    case 'delegation':
      return <PresentationDetail presentation={row.presentation} threadId={threadId} />;
    default:
      return null;
  }
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
  const original = () => (
    <HostWorkRowBody row={row} threadId={threadId} onOpenDiff={onOpenDiff} />
  );
  if (isPluginRenderableWorkRow(row)) {
    return <PluginTimelineRendererBody row={row} original={original} />;
  }
  return original();
}
