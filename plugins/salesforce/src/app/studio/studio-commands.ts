import { AGENT_SCRIPT_TOOLS, type useAgentScriptTools } from '../AgentScriptTools.js';
import { controlText } from '../useSalesforceControl.js';
import type { ControlState, UiCommand } from '../../../lib/workbench-control.js';

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
}

export type StudioCommandExecutor = (command: UiCommand) => Promise<void | ControlState>;

/** The `execute` switch of the Agentforce playground control surface. */
export function createStudioCommandExecutor(targets: StudioCommandTargets): StudioCommandExecutor {
  return async ({ command, input }) => {
    if (command === 'state') return input.includeSource === true ? { source: targets.getSource() } : {};
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
