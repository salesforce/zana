export type FlowHarness = 'Claude Code' | 'Cursor' | 'Codex' | 'OpenCode';

export type FlowTool = { label: string; done: boolean };

export interface FlowScene {
  view: 'home' | 'kanban' | 'thread';
  harness: FlowHarness;
  pickerOpen: boolean;
  pickerHighlight: FlowHarness | null;
  homeDraft: string;
  threadDraft: string;
  loading: boolean;
  userSent: boolean;
  tools: FlowTool[];
  assistant: string;
  diagram: 'hidden' | 'shown';
  sideTab: 'info' | 'diff';
  sideWide: boolean;
  status: 'working' | 'idle';
  caret: 'home' | 'thread' | null;
  sendPulse: 'home' | 'thread' | null;
  harnessHot: boolean;
  caption: string;
}

export const FLOW_HARNESSES: readonly FlowHarness[] = [
  'Claude Code',
  'Cursor',
  'Codex',
  'OpenCode'
];

export const HOME_PROMPT = 'Fix the flaky checkout tests';
export const THREAD_TITLE = 'Fix flaky checkout tests';
export const ASSISTANT_REPLY =
  'The retries cluster in two suites. Isolating the Stripe mock per test.';

export const CHAR_MS = 42;
export const STREAM_MS = 22;

const typeDur = HOME_PROMPT.length * CHAR_MS;
const streamDur = ASSISTANT_REPLY.length * STREAM_MS;

export const T = {
  pickerOpen: 900,
  cursorHot: 1700,
  cursorSelected: 2400,
  pickerClose: 3000,
  typeHome: 3300
} as const;

export const T_SEND_HOME = T.typeHome + typeDur + 280;
export const T_LOADING = T_SEND_HOME + 180;
export const T_KANBAN = T_LOADING + 1700;
export const T_THREAD = T_KANBAN + 1800;
export const T_TYPE_THREAD = T_THREAD + 450;
export const T_SEND_THREAD = T_TYPE_THREAD + typeDur + 220;
export const T_USER_SENT = T_SEND_THREAD + 120;
export const T_TOOL_READ = T_USER_SENT + 650;
export const T_TOOL_EDIT = T_TOOL_READ + 900;
export const T_TOOL_RERUN = T_TOOL_EDIT + 1050;
export const T_STREAM = T_TOOL_RERUN + 700;
export const T_DIAGRAM = T_STREAM + streamDur + 180;
export const FLOW_LOOP_MS = T_DIAGRAM + 3500;

const TOOL_READ: FlowTool = { label: 'Read checkout.spec.ts', done: true };
const TOOL_EDIT: FlowTool = { label: 'Edit checkout.spec.ts', done: true };
const TOOL_RERUN: FlowTool = { label: 'Re-ran checkout suite', done: true };

function typed(text: string, start: number, now: number, msPerChar: number): string {
  if (now < start) return '';
  const chars = Math.floor((now - start) / msPerChar);
  return text.slice(0, Math.max(0, Math.min(text.length, chars)));
}

function inRange(now: number, start: number, end: number): boolean {
  return now >= start && now < end;
}

function captionFor(now: number): string {
  if (now >= T_DIAGRAM) return 'A diagram of the flake — isolate the Stripe mock.';
  if (now >= T_STREAM) return 'Retries cluster in two suites.';
  if (now >= T_TOOL_EDIT) return 'The fix, in the Diff pane.';
  if (now >= T_TOOL_READ) return 'Cursor is reading the suite.';
  if (now >= T_USER_SENT) return 'Cursor is working.';
  if (now >= T_TYPE_THREAD) return 'Send the request.';
  if (now >= T_THREAD) return 'The thread opens.';
  if (now >= T_KANBAN) return 'The thread lands on the board.';
  if (now >= T_LOADING) return 'Starting Cursor…';
  if (now >= T.typeHome) return 'Describe the work.';
  if (now >= T.cursorSelected) return 'Use Cursor.';
  if (now >= T.pickerOpen) return 'Choose a harness.';
  return 'Start a Modern thread. Pick a harness and describe the work.';
}

export function sceneForElapsed(ms: number): FlowScene {
  const now = Number.isFinite(ms) ? Math.max(0, ms) : 0;
  const harness: FlowHarness = now >= T.cursorSelected ? 'Cursor' : 'Claude Code';
  const pickerOpen = inRange(now, T.pickerOpen, T.pickerClose);
  const view: FlowScene['view'] =
    now >= T_THREAD ? 'thread' : now >= T_KANBAN ? 'kanban' : 'home';
  const loading = inRange(now, T_LOADING, T_KANBAN);
  const userSent = now >= T_USER_SENT;
  const tools: FlowTool[] = [];
  if (now >= T_TOOL_READ) tools.push(TOOL_READ);
  if (now >= T_TOOL_EDIT) tools.push(TOOL_EDIT);
  if (now >= T_TOOL_RERUN) tools.push(TOOL_RERUN);

  let pickerHighlight: FlowHarness | null = null;
  if (pickerOpen) {
    pickerHighlight = now >= T.cursorHot ? 'Cursor' : 'Claude Code';
  }

  let caret: FlowScene['caret'] = null;
  if (inRange(now, T.typeHome, T_SEND_HOME)) caret = 'home';
  else if (inRange(now, T_THREAD, T_SEND_THREAD)) caret = 'thread';

  let sendPulse: FlowScene['sendPulse'] = null;
  if (inRange(now, T_SEND_HOME, T_LOADING)) sendPulse = 'home';
  else if (inRange(now, T_SEND_THREAD, T_USER_SENT + 280)) sendPulse = 'thread';

  return {
    view,
    harness,
    pickerOpen,
    pickerHighlight,
    homeDraft: typed(HOME_PROMPT, T.typeHome, now, CHAR_MS),
    threadDraft: userSent ? '' : typed(HOME_PROMPT, T_TYPE_THREAD, now, CHAR_MS),
    loading,
    userSent,
    tools,
    assistant: typed(ASSISTANT_REPLY, T_STREAM, now, STREAM_MS),
    diagram: now >= T_DIAGRAM ? 'shown' : 'hidden',
    sideTab: now >= T_TOOL_EDIT ? 'diff' : 'info',
    sideWide: now >= T_TOOL_EDIT,
    status: view === 'thread' && now < T_DIAGRAM ? 'working' : 'idle',
    caret,
    sendPulse,
    harnessHot: inRange(now, T.pickerOpen, T.pickerClose),
    caption: captionFor(now)
  };
}

export function completedScene(): FlowScene {
  return sceneForElapsed(T_DIAGRAM);
}
