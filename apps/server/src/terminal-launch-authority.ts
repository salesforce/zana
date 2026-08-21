import { realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, sep } from 'node:path';
import type {
  TerminalHostBinding,
  TerminalHostEvent,
  TerminalRequestCommand
} from '@zana-ai/zcc-contracts/terminal-execution';
import type { ProjectStore } from './project-store.js';
import type { TerminalSessionRecord } from './terminal-session-service.js';

export interface TerminalLaunchAuthorityOptions {
  projects: ProjectStore;
  binding: TerminalHostBinding;
  getSession(sessionId: string): TerminalSessionRecord | null;
  execute(command: TerminalRequestCommand): Promise<TerminalHostEvent[]>;
}

function rejected(
  command: Pick<TerminalRequestCommand, 'protocolVersion' | 'commandId' | 'sessionId' | 'launchEpoch'>,
  binding: TerminalHostBinding
): TerminalHostEvent[] {
  return [{
    kind: 'rejected',
    protocolVersion: command.protocolVersion,
    binding,
    commandId: command.commandId,
    sessionId: command.sessionId,
    launchEpoch: command.launchEpoch,
    reason: 'terminal launch is not authorized'
  }];
}

function isContained(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`));
}

function sameBinding(left: TerminalHostBinding | undefined, right: TerminalHostBinding): boolean {
  return left !== undefined &&
    left.hostId === right.hostId &&
    left.instanceId === right.instanceId &&
    left.hostConnectionId === right.hostConnectionId;
}

/**
 * Authorizes the first server-owned part of a direct terminal launch: only a
 * local project may supply a canonical working directory under its own root.
 * Provider argv and environment construction intentionally remain in the
 * desktop compatibility planner until their byte-sensitive migration is ready.
 */
export function createTerminalLaunchAuthority({ projects, binding, getSession, execute }: TerminalLaunchAuthorityOptions) {
  return {
    async execute(command: TerminalRequestCommand): Promise<TerminalHostEvent[]> {
      if (command.kind !== 'start') {
        const session = getSession(command.sessionId);
        if (
          !session ||
          session.launchEpoch !== command.launchEpoch ||
          session.state === 'exited' ||
          !sameBinding(session.binding, binding)
        ) {
          return rejected(command, binding);
        }
        return execute(command);
      }
      if (command.launch.mode !== 'local-pty' || !isAbsolute(command.launch.cwd)) return rejected(command, binding);

      const project = projects.list().find((candidate) => candidate.id === command.projectId);
      if (!project || 'remote' in project) return rejected(command, binding);

      try {
        const root = realpathSync(project.path);
        const cwd = realpathSync(command.launch.cwd);
        if (!statSync(root).isDirectory() || !statSync(cwd).isDirectory() || !isContained(root, cwd)) {
          return rejected(command, binding);
        }
        return execute({ ...command, launch: { ...command.launch, cwd } });
      } catch {
        return rejected(command, binding);
      }
    }
  };
}
