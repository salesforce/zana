import { AGENT_SCRIPT_TOOLS, type useAgentScriptTools } from '../AgentScriptTools.js';
import { controlText } from '../useSalesforceControl.js';
import type { ControlState, UiCommand } from '../../../lib/workbench-control.js';
import type { ProposalOutcome, ProposeEditInput, StudioEngine } from '../../../lib/studio-contract.js';
import { validateUiCommandInput } from '../../../lib/ui-command-input.js';

/** Everything the executor needs from the live panel. Getters keep it free of stale closures. */
export interface StudioCommandTargets {
  /** Whole-source access for `state` with includeSource. */
  getSource(): string;
  /** True when switching files would lose work (dirty draft or save in flight). */
  isBusyOrDirty(): boolean;
  refreshFiles(): Promise<void>;
  openFile(path: string): Promise<boolean>;
  setFileQuery(query: string): void;
  revealLine(line: number): void;
  tools: Pick<ReturnType<typeof useAgentScriptTools>, 'openTool' | 'close' | 'setOpen'>;
  /** editor.proposeEdit. Absent in views without the Monaco editor (the verb then reports "unsupported"). */
  proposeEdit?: {
    /** The open file's path and last-saved sha256 (null path when nothing is open). */
    current(): { path: string | null; sha256?: string };
    /** Shows the proposal (decorations, per-hunk accept/reject) and settles when the user resolves it. */
    start(input: ProposeEditInput, proposalId: string): Promise<ProposalOutcome>;
  };
  /** preview.start / preview.send. */
  preview?: {
    start(input: { engine?: StudioEngine }): Promise<void | ControlState> | void | ControlState;
    send(input: { text: string; engine?: StudioEngine }): Promise<void | ControlState> | void | ControlState;
  };
  traceFocus?(input: { runId?: string; turn?: number; step?: number }): Promise<void | ControlState> | void | ControlState;
  graphFocus?(node: string): Promise<void | ControlState> | void | ControlState;
  layoutSet?(compact: boolean): void;
}

const unsupported = (command: string) => Error(`${command} is not supported in this view.`);
let proposalCounter = 0;
const newProposalId = () => globalThis.crypto?.randomUUID?.() ?? `proposal-${Date.now().toString(36)}-${++proposalCounter}`;

export type StudioCommandExecutor = (command: UiCommand) => Promise<void | ControlState>;

/** The `execute` switch of the Agentforce playground control surface. */
export function createStudioCommandExecutor(targets: StudioCommandTargets): StudioCommandExecutor {
  return async ({ command, input }) => {
    if (command === 'state') return input.includeSource === true ? { source: targets.getSource() } : {};
    const invalid = validateUiCommandInput(command, input);
    if (invalid) throw Error(invalid);
    if (command === 'editor.proposeEdit') {
      const target = targets.proposeEdit;
      if (!target) throw unsupported(command);
      const proposal = input as unknown as ProposeEditInput;
      if (target.current().path !== proposal.path) {
        if (targets.isBusyOrDirty()) throw Error('Save the current draft before the agent proposes an edit to another file.');
        await targets.refreshFiles();
        if (!await targets.openFile(proposal.path)) throw Error('Could not open the file the proposal targets.');
      }
      const open = target.current();
      if (open.path !== proposal.path) throw Error('The proposal targets a file that is not open.');
      if (open.sha256 !== proposal.expectedSha256) throw Error('The file changed since the agent read it. Re-read it and propose again.');
      const proposalId = newProposalId();
      const settled = target.start(proposal, proposalId);
      settled.catch(() => {}); // the hook reports rejections through control.outcome
      return { pending: 'user', proposalId, settled, path: proposal.path };
    }
    if (command === 'preview.start' || command === 'preview.send') {
      if (!targets.preview) throw unsupported(command);
      return command === 'preview.start' ? targets.preview.start({ engine: input.engine as StudioEngine | undefined }) : targets.preview.send({ text: String(input.text), engine: input.engine as StudioEngine | undefined });
    }
    if (command === 'trace.focus') {
      if (!targets.traceFocus) throw unsupported(command);
      return targets.traceFocus({ runId: input.runId as string | undefined, turn: input.turn as number | undefined, step: input.step as number | undefined });
    }
    if (command === 'graph.focus') {
      if (!targets.graphFocus) throw unsupported(command);
      return targets.graphFocus(String(input.node));
    }
    if (command === 'layout.set') {
      if (!targets.layoutSet) throw unsupported(command);
      targets.layoutSet(input.compact === true); return { compact: input.compact === true };
    }
    if (command === 'file.open') {
      if (targets.isBusyOrDirty()) throw Error('Save the current draft before switching files.');
      const path = controlText(input, 'path');
      await targets.refreshFiles();
      if (!await targets.openFile(path)) throw Error('Could not open the requested file.');
      return { path };
    }
    if (command === 'file.filter') { targets.setFileQuery(controlText(input, 'query', 200)); targets.tools.openTool('files'); return; }
    if (command === 'editor.reveal') {
      if (!Number.isInteger(input.line) || Number(input.line) < 1) throw Error('Provide a positive, 1-based line.');
      targets.revealLine(Number(input.line)); return { revealedLine: input.line };
    }
    if (command === 'panel.show' || command === 'panel.hide') { targets.tools.setOpen(command === 'panel.show'); return; }
    const tool = AGENT_SCRIPT_TOOLS.find(row => row.id === input.tool);
    if (!tool) throw Error('Choose a known Agentforce tool.');
    if (command === 'panel.open') targets.tools.openTool(tool.id); else targets.tools.close(tool.id);
  };
}
