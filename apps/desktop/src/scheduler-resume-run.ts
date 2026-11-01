/**
 * Reopen a finished scheduled run's agent conversation in a new tab.
 *
 * The launch copies History's Resume (`ipc/sessions.ts`): the harness's own
 * `nativeConversationResume` projection plus an interactive terminal, with no
 * prompt sent. The schedule's persona is deliberately not reapplied: its
 * `initialPrompt` would be typed into the resumed conversation, a persona pinned
 * to an unattended profile conflicts with the resume projection, and the
 * conversation history already carries the earlier context. The old pty id is
 * never reused (a new tab always gets a fresh one), so the reopened tab is not a
 * run: it cannot receive the old run's report or finish, and does not count for
 * overlap or the scheduled-run cap, which only match a run's `sessionId`.
 *
 * Main owns every decision (Rules 1 and 2): the renderer sends only a schedule
 * id and an optional run id; the project, folder, harness and conversation id
 * are resolved here, and the id is validated because schedule files are editable.
 * Only an id the run recorded itself is used (minted at launch, or detected while
 * the run was live). Nothing is guessed afterwards: a folder-and-time lookup days
 * later can pick a newer conversation in the same folder and reopen the wrong one.
 * Every host service is injected so the logic is testable without the host.
 */
import type { CreateTerminalRequest, Project, Result, ScheduledTask, ScheduleRun, TerminalSession } from '@zana-ai/zcc-domain/product';
import { latestResumableRun, resumableRun } from '@zana-ai/zcc-domain/schedule-health';
import type { NativeConversationResume } from '@zana-ai/zcc-host-daemon/harness/registration';

export interface ResumeRunInput { scheduleId: string; runId?: string }
export interface ResumeRunValue { session: TerminalSession; reused: boolean }

interface Registration {
  /** The harness family: every profile of one harness (claude, claude-yolo, claude-resume) shares it. */
  id: string;
  nativeConversationResume?: (id: string) => NativeConversationResume | undefined;
  nativeConversationId?: (session: TerminalSession) => string | undefined;
}

export interface ResumeRunDeps {
  getTask: (scheduleId: string) => ScheduledTask | undefined;
  listProjects: () => Project[];
  /** Live (not exited) sessions of a project. */
  listLiveSessions: (projectId: string) => TerminalSession[];
  createInteractiveTerminal: (req: CreateTerminalRequest) => Promise<Result<TerminalSession>>;
  registrationFor: (profile: string) => Registration | undefined;
  realpath: (path: string) => string;
}

type ResumableRegistration = Registration & { nativeConversationResume: NonNullable<Registration['nativeConversationResume']> };
const fail = <T = ResumeRunValue>(code: string, message: string): Result<T> => ({ ok: false, code, message });
const NO_CONVERSATION = "This run didn't record a conversation to reopen";
const UNSUPPORTED = "This agent can't reopen a past conversation";

/**
 * Opens still waiting for their terminal, by project + harness + conversation id.
 * Two clicks (or two windows) that both pass the live-tab check before either tab
 * exists join the same open instead of starting two agents on one conversation.
 * The key carries the project and harness because ids are only unique within one
 * harness, and the same id recorded in another project is another conversation.
 */
const opening = new Map<string, Promise<Result<ResumeRunValue>>>();

const openingKey = (projectId: string, harness: string, id: string): string => JSON.stringify([projectId, harness, id]);

/** Collapse `.`, `..` and repeated or trailing slashes. Pure string work: the folder lives on another host, so no realpath. */
export function normalizePosixPath(path: string): string {
  const out: string[] = [];
  for (const part of path.trim().split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return `/${out.join('/')}`;
}

const moved = () => fail<{ cwd?: string }>('CONVERSATION_MOVED', "This run's conversation was recorded in another folder, so it can't be reopened here");

/**
 * Rule 2: reopen only in the folder the conversation was recorded in. The recorded folder comes
 * from an editable file, and a global schedule can move to another project.
 * Local: both sides are realpath'd. Remote: the folder is on another host, so compare normalised
 * POSIX paths against the folder the project record names (`remote.remotePath`). A remote project
 * that names none starts in a machine, global or home default resolved at launch, which the record
 * cannot tell us, so there is nothing to compare against.
 */
function checkFolder(project: Project, recordedCwd: string, deps: Pick<ResumeRunDeps, 'realpath'>): Result<{ cwd?: string }> {
  if (project.remote) {
    const named = project.remote.remotePath?.trim();
    // `project.path` also counts: a local-agent-with-remote-tools session records the project's own path.
    if (named?.startsWith('/') && ![named, project.path].map(normalizePosixPath).includes(normalizePosixPath(recordedCwd))) return moved();
    return { ok: true, value: {} };
  }
  let cwd: string;
  try { cwd = deps.realpath(project.path); }
  catch { return fail<{ cwd?: string }>('PROJECT_MISSING', 'The project folder for this schedule is missing'); }
  let recorded: string | undefined;
  try { recorded = deps.realpath(recordedCwd); } catch { recorded = undefined; }
  return recorded === cwd ? { ok: true, value: { cwd } } : moved();
}

/** Reuse an already open tab (the run's own, or any live tab of the same harness on the same conversation), else launch once. */
async function reuseOrLaunch(
  project: Project, task: ScheduledTask, run: ScheduleRun, id: string, cwd: string | undefined,
  registration: ResumableRegistration, deps: ResumeRunDeps
): Promise<Result<ResumeRunValue>> {
  const live = deps.listLiveSessions(project.id);
  const ownTab = run.sessionId ? live.find((session) => session.id === run.sessionId) : undefined;
  if (ownTab) return { ok: true, value: { session: ownTab, reused: true } };
  // An id only means something within its own harness, but the resume tab opens under the harness's fixed
  // resume profile, not the recorded one (claude-yolo reopens as claude): compare harnesses, not profile names.
  const sameConversation = live.find((session) => deps.registrationFor(session.profile) === registration && registration.nativeConversationId?.(session) === id);
  if (sameConversation) return { ok: true, value: { session: sameConversation, reused: true } };

  const key = openingKey(project.id, registration.id, id);
  const pending = opening.get(key);
  if (pending) {
    const joined = await pending;
    return joined.ok ? { ok: true, value: { session: joined.value.session, reused: true } } : joined;
  }
  const resume = registration.nativeConversationResume(id);
  if (!resume) return fail('UNSUPPORTED', UNSUPPORTED);
  const open = (async (): Promise<Result<ResumeRunValue>> => {
    const created = await deps.createInteractiveTerminal({
      projectId: project.id,
      cwd,
      cols: 80,
      rows: 24,
      title: `↺ ${task.name}`,
      ...resume
    } as CreateTerminalRequest);
    return created.ok ? { ok: true, value: { session: created.value, reused: false } } : created;
  })();
  opening.set(key, open);
  try { return await open; }
  finally { opening.delete(key); }
}

export async function resumeScheduledRun(input: ResumeRunInput, deps: ResumeRunDeps): Promise<Result<ResumeRunValue>> {
  const task = deps.getTask(input.scheduleId);
  if (!task) return fail('NOT_FOUND', 'This schedule is no longer available');

  const runs = task.status?.runs ?? [];
  const run = input.runId === undefined ? latestResumableRun(runs) : runs.find((candidate) => candidate.id === input.runId);
  if (input.runId !== undefined && !run) return fail('RUN_NOT_FOUND', "This run is no longer in the schedule's history");
  // One rule for "latest" and an explicit run: launched, not a Squad run, valid recorded id.
  if (!run || !resumableRun(run)) return fail('NO_CONVERSATION', NO_CONVERSATION);
  const conversation = run.conversation!;

  const project = deps.listProjects().find((candidate) => candidate.id === task.projectId);
  if (!project) return fail('PROJECT_MISSING', 'The project for this schedule is no longer registered');
  const folder = checkFolder(project, conversation.cwd, deps);
  if (!folder.ok) return folder;

  const registration = deps.registrationFor(conversation.profile);
  if (!registration?.nativeConversationResume) return fail('UNSUPPORTED', UNSUPPORTED);
  return reuseOrLaunch(project, task, run, conversation.id!, folder.value.cwd, registration as ResumableRegistration, deps);
}
