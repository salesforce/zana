import { useEffect, useState, type ReactNode } from 'react';
import {
  Bot,
  FolderGit2,
  Clock,
  Check,
  X,
  ArrowRight,
  ArrowLeft,
} from 'lucide-react';
import { useUi } from '../store.js';

/**
 * First-run walkthrough — a lightweight, three-step tour that introduces the
 * core loop of Command Center to a brand-new user:
 *   1. Launch an agent (a Quick Agent from the Agents view),
 *   2. Add a project (a folder to work in),
 *   3. Create a schedule (recurring agent runs).
 *
 * Each step navigates the shell to the relevant view so the user sees the real
 * surface behind the card, then points at the control to use. Read and click
 * Next. The steps are read-only and point to the real controls in the shell.
 *
 * Auto-opens once (gated on AppConfig.walkthroughCompleted in the data store's
 * init) in the main window only; re-openable from Settings. Finishing or
 * skipping flips `walkthroughCompleted` true so it never auto-opens again.
 */

interface Step {
  id: string;
  icon: typeof Bot;
  title: string;
  body: ReactNode;
}

const STEPS: Step[] = [
  {
    id: 'agent',
    icon: Bot,
    title: 'Launch an agent',
    body: (
      <p>
        Open <strong>Agents</strong> in the left rail and hit <strong>＋</strong> to start a Quick
        Agent — a Claude session in a scratch workspace, no project needed.
      </p>
    )
  },
  {
    id: 'project',
    icon: FolderGit2,
    title: 'Add a project',
    body: (
      <p>
        Open <strong>Projects</strong> and click <strong>＋</strong> in the list header to point
        Zana at a folder. Agents run there with its terminals, files, and git.
      </p>
    )
  },
  {
    id: 'schedule',
    icon: Clock,
    title: 'Create a schedule',
    body: (
      <p>
        Open <strong>Scheduler</strong> and click <strong>New schedule</strong> to run an agent on
        a recurring cadence — results land in your <strong>Inbox</strong>.
      </p>
    )
  }
];

interface Props {
  onClose: () => void;
}

export function Walkthrough({ onClose }: Props) {
  const [index, setIndex] = useState(0);
  const setNav = useUi((s) => s.setNav);

  const step = STEPS[index];
  const isFirst = index === 0;
  const isLast = index === STEPS.length - 1;

  // Move the shell to the view each step describes, so the spotlight card sits
  // over the real surface the user is being pointed at.
  useEffect(() => {
    if (step.id === 'agent') setNav('agents');
    else if (step.id === 'project') setNav('home');
    else if (step.id === 'schedule') setNav('scheduler');
  }, [step.id, setNav]);

  // Esc skips (same as the Skip button) — both mark the walkthrough done.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const next = () => {
    if (isLast) onClose();
    else setIndex((i) => i + 1);
  };
  const back = () => setIndex((i) => Math.max(0, i - 1));

  const Icon = step.icon;

  return (
    <div className="palette-backdrop walkthrough-backdrop" onMouseDown={onClose}>
      <div
        className="walkthrough-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="walkthrough-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button className="walkthrough-skip" type="button" onClick={onClose}>
          <X size={13} /> Skip
        </button>

        <div className="walkthrough-icon">
          <Icon size={26} strokeWidth={1.75} />
        </div>

        <div className="walkthrough-step-label">
          Step {index + 1} of {STEPS.length}
        </div>
        <h3 id="walkthrough-title" className="walkthrough-title">
          {step.title}
        </h3>

        <div className="walkthrough-body">{step.body}</div>

        <div className="walkthrough-dots" aria-hidden="true">
          {STEPS.map((s, i) => (
            <span key={s.id} className={`walkthrough-dot ${i === index ? 'active' : ''}`} />
          ))}
        </div>

        <div className="walkthrough-footer">
          <button
            type="button"
            className="btn ghost walkthrough-back"
            onClick={back}
            disabled={isFirst}
          >
            <ArrowLeft size={14} /> Back
          </button>
          <button type="button" className="btn walkthrough-next" onClick={next}>
            {isLast ? (
              <>
                <Check size={14} /> Done
              </>
            ) : (
              <>
                Next <ArrowRight size={14} />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
