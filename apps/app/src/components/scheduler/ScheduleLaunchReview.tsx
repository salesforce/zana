import React, { useEffect, useState } from 'react';
import type { ScheduledTask } from '@zana-ai/zcc-domain/product';
import type { ExecutionResolvedLaunchV1 } from '@zana-ai/zcc-domain/launch-options';
import { product } from '../../lib/product-client.js';
import type { SquadLaunchPreview } from '@zana-ai/zcc-domain/squad-proposal';
import { SquadResolvedLaunchDetails } from '../SquadLaunchSettings.js';

export function ScheduleLaunchReview({ task, onConfirm, onCancel }: {
  task: ScheduledTask;
  onConfirm: (previewToken: string) => void;
  onCancel: () => void;
}) {
  const [review, setReview] = useState<{ task: ScheduledTask; resolved?: ExecutionResolvedLaunchV1; preview?: SquadLaunchPreview & { previewToken: string }; error?: string } | null>(null);
  useEffect(() => {
    let active = true;
    void product.scheduler.previewTeamLaunch(task.id)
      .then(result => {
        if (active) setReview(result.ok ? { task, resolved: result.value.resolvedLaunch, preview: result.value } : { task, error: result.message });
      }).catch(error => {
        if (active) setReview({ task, error: error instanceof Error ? error.message : 'Launch preview unavailable' });
      });
    return () => { active = false; };
  }, [task]);
  const current = review?.task === task ? review : null;
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div role="dialog" aria-modal="true" aria-label="Review scheduled squad launch" className="modal scheduler-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header"><h3>Review scheduled squad launch</h3></div>
        <div className="modal-body">
          <p>{task.name}. Each run revalidates the plan, squad and target.</p>
          {current?.error ? <p role="alert" className="modal-error">{current.error}</p> : current?.resolved ? (
            <>
              {current.preview?.location ? <p>Location: {current.preview.location.kind === 'new-worktree'
                ? `New worktree from ${current.preview.location.baseBranch}; path assigned at launch`
                : `${current.preview.branch ?? 'HEAD'} - ${current.preview.path}`}</p> : null}
              <SquadResolvedLaunchDetails resolved={current.resolved} projectId={task.projectId} />
            </>
          ) : <p>Resolving launch settings…</p>}
        </div>
        <div className="modal-footer">
          <button type="button" className="settings-btn" onClick={onCancel}>Cancel</button>
          <button type="button" className="settings-btn" disabled={!current?.resolved || !current?.preview?.previewToken} onClick={() => {
            if (current?.preview?.previewToken) onConfirm(current.preview.previewToken);
          }}>Launch schedule</button>
        </div>
      </div>
    </div>
  );
}
