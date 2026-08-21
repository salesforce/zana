import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ScheduleRun } from '@zana-ai/zcc-domain/product';
import { Modal } from '../Modal.js';
import { formatDuration } from './schedulerUtils.js';

interface RunReportModalProps {
  run: ScheduleRun;
  taskName: string;
  onClose: () => void;
}

/**
 * Run report viewer. Renders the agent-authored markdown summary for one run.
 * Reuses the `.inbox-md` markdown styling (same as InboxDetail) and the shared
 * modal scaffold. Opened from a run row or the Overview recent-activity list —
 * works regardless of whether the session is still alive (the whole point: a
 * report is most useful after the run has finished).
 */
export function RunReportModal({ run, taskName, onClose }: RunReportModalProps) {
  // Prefer the agent's self-assessment; fall back to the process result. Class
  // and label use the same value so the pill colour always matches the text.
  const badge = run.reportStatus ?? run.result;

  return (
    <Modal
      title={`${taskName} — run report`}
      onClose={onClose}
      className="scheduler-report-modal"
      bodyClassName="scheduler-report-body"
      header={
        <>
          <div className="modal-header">
            <h3>{taskName} — run report</h3>
            <button className="icon-button" onClick={onClose} aria-label="Close">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <div className="scheduler-report-meta">
            <span className={`scheduler-pill scheduler-pill--${badge}`}>{badge}</span>
            <span className="scheduler-report-meta-when">
              {new Date(run.at).toLocaleString()}
            </span>
            {run.durationMs !== undefined && (
              <span className="scheduler-report-meta-dur">{formatDuration(run.durationMs)}</span>
            )}
          </div>
        </>
      }
    >
      <div className="inbox-md">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: (props) => <a {...props} target="_blank" rel="noreferrer" />
          }}
        >
          {run.report ?? ''}
        </ReactMarkdown>
      </div>
    </Modal>
  );
}
