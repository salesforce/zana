import { useId, useMemo, useState } from 'react';
import type { ExecutionBoardSnapshot } from '@zana-ai/zcc-domain/product';

type RunEvent = ExecutionBoardSnapshot['events'][number];
type Work = NonNullable<ExecutionBoardSnapshot['execution']['work']>;
type Milestone = { title: string; tone: 'done' | 'waiting' | 'working' | 'failed' };

const WORK_TRANSITIONS = {
  completed: { suffix: 'completed', tone: 'done' },
  blocked: { suffix: 'blocked', tone: 'waiting' },
  failed: { suffix: 'failed', tone: 'failed' }
} as const;

function describeMilestone(event: RunEvent, titles: ReadonlyMap<string, string>): Milestone | undefined {
  const step = /^Work unit (completed|blocked|failed): (.+)$/.exec(event.summary);
  if (step) {
    const [, transition, unitId] = step;
    const { suffix, tone } = WORK_TRANSITIONS[transition as keyof typeof WORK_TRANSITIONS];
    return { title: `${titles.get(unitId) ?? unitId} ${suffix}`, tone };
  }
  if (event.summary.startsWith('Execution blocker response accepted:')) return { title: 'Answer queued for delivery', tone: 'working' };
  if (event.summary.startsWith('Execution blocker response delivered:')) return { title: 'Worker acknowledged the answer', tone: 'done' };
  if (event.eventType === 'blocker' || event.blocker) return { title: event.summary, tone: 'waiting' };
  if (event.eventType === 'failure' || event.severity === 'error') return { title: event.summary, tone: 'failed' };
  if (event.eventType === 'outcome') return { title: event.summary, tone: 'done' };
  if (event.progress) return { title: event.summary, tone: 'working' };
  return undefined;
}

function EventTime({ timestamp }: { timestamp: number }) {
  const date = new Date(timestamp);
  return <time dateTime={date.toISOString()} title={date.toLocaleString()}>
    {date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
  </time>;
}

export function ExecutionRunActivity({ events, work, truncated }: {
  events: readonly RunEvent[];
  work?: Work;
  truncated: boolean;
}) {
  const headingId = useId();
  const [logOpen, setLogOpen] = useState(false);
  const [warningsOnly, setWarningsOnly] = useState(false);
  const milestones = useMemo(() => {
    const titles = new Map(work?.assignments.map((step) => [step.workUnitId, step.title]));
    const result: Array<Milestone & { event: RunEvent }> = [];
    for (let index = events.length - 1; index >= 0 && result.length < 3; index -= 1) {
      const event = events[index];
      const milestone = describeMilestone(event, titles);
      if (milestone) result.push({ ...milestone, event });
    }
    return result;
  }, [events, work]);
  const filtered = logOpen
    ? events.filter((event) => !warningsOnly || event.severity === 'warning').reverse()
    : [];

  return (
    <section className="execution-run-card" aria-labelledby={headingId}>
      <div className="execution-run-card-heading"><h4 id={headingId}>Recent activity</h4></div>
      {milestones.length > 0 ? (
        <ol className="execution-run-milestones">
          {milestones.map(({ event, title, tone }) => (
            <li key={event.id}>
              <span className="execution-run-dot" data-tone={tone} aria-hidden="true" />
              <span>{title}</span>
              <EventTime timestamp={event.createdAt} />
            </li>
          ))}
        </ol>
      ) : <p className="execution-run-empty">No work milestones yet.</p>}
      {events.length > 0 && (
        <details className="execution-run-disclosure execution-run-log" onToggle={(event) => setLogOpen(event.currentTarget.open)}>
          <summary>{truncated ? 'Recent events' : 'All events'} ({events.length})</summary>
          {logOpen && (
            <>
              {truncated && <p className="execution-run-info">Showing the latest {events.length} events for this run.</p>}
              <label className="execution-run-log-filter">
                <input type="checkbox" checked={warningsOnly} onChange={(event) => setWarningsOnly(event.target.checked)} />
                Warnings only
              </label>
              {filtered.length ? (
                <ol aria-label="Event log" className="execution-run-events">
                  {filtered.map((event) => (
                    <li key={event.id}>
                      <EventTime timestamp={event.createdAt} />
                      <details>
                        <summary><span className="execution-run-event-severity" data-severity={event.severity}>{event.severity}</span> {event.summary}</summary>
                        <div className="execution-run-event-detail">
                          <p>{[event.producerRole, event.slotId, event.eventType].filter(Boolean).join(' · ')}</p>
                          {event.detail && <p>{event.detail}</p>}
                          {event.progress && <p>{event.progress.completed}/{event.progress.total}</p>}
                          {event.references?.map((reference) => <p key={reference.uri}>{reference.label}: {reference.uri}</p>)}
                        </div>
                      </details>
                    </li>
                  ))}
                </ol>
              ) : <p className="execution-run-info" role="status">No warnings in this event log.</p>}
            </>
          )}
        </details>
      )}
    </section>
  );
}
