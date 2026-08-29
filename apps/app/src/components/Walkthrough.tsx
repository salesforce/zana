import { useEffect, useState, type ReactNode } from 'react';
import {
  Bot,
  FolderGit2,
  Clock,
  Check,
  X,
  ArrowRight,
  ArrowLeft,
  MessageSquare
} from 'lucide-react';
import { useUi } from '../store.js';
import {
  WALKTHROUGH_STEP_IDS,
  walkthroughShellFor,
  type WalkthroughStepId
} from './walkthrough-shell.js';

/**
 * First-run walkthrough — a four-step tour of the core loop:
 *   1. Start a Modern conversation (the BB-inspired composer on New Chat),
 *   2. Flip to CLI Agent on the same page (the original PTY launcher),
 *   3. Add a project (a folder to work in),
 *   4. Create a schedule (recurring agent runs).
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
  id: WalkthroughStepId;
  icon: typeof Bot;
  title: string;
  body: ReactNode;
}

const STEPS: Step[] = [
  {
    id: 'thread',
    icon: MessageSquare,
    title: 'Start a conversation',
    body: (
      <p>
        Open <strong>New Chat</strong> and stay on <strong>Modern</strong>. Type a prompt and send
        — Zana starts a conversation with a chat timeline, tools, and a side panel.
      </p>
    )
  },
  {
    id: 'legacy',
    icon: Bot,
    title: 'CLI Agent still works',
    body: (
      <p>
        Need a terminal session instead? Flip to <strong>CLI Agent</strong> on the same page.
        That still launches the original PTY agent in a workspace.
      </p>
    )
  },
  {
    id: 'project',
    icon: FolderGit2,
    title: 'Add a project',
    body: (
      <p>
        In <strong>Workspaces</strong> on the left rail, click <strong>＋</strong> to point Zana at
        a folder. Agents run there with its files and git.
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
  const setWalkthroughHomeMode = useUi((s) => s.setWalkthroughHomeMode);

  const step = STEPS[index];
  const isFirst = index === 0;
  const isLast = index === STEPS.length - 1;
  const composerStep = step.id === 'thread' || step.id === 'legacy';

  // Move the shell to the view each step describes, so the spotlight card sits
  // over the real surface the user is being pointed at. Modern / CLI Agent
  // also drive the New Chat switcher so that composer is actually on screen.
  useEffect(() => {
    const shell = walkthroughShellFor(step.id);
    setNav(shell.nav);
    setWalkthroughHomeMode(shell.homeMode);
  }, [step.id, setNav, setWalkthroughHomeMode]);

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
    <div
      className={`palette-backdrop walkthrough-backdrop${composerStep ? ' walkthrough-backdrop--composer' : ''}`}
      onMouseDown={onClose}
    >
      <div
        className="walkthrough-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="walkthrough-title"
        data-testid="walkthrough-dialog"
        data-walkthrough-step={step.id}
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
          {WALKTHROUGH_STEP_IDS.map((id, i) => (
            <span key={id} className={`walkthrough-dot ${i === index ? 'active' : ''}`} />
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
