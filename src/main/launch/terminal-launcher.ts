import type { TerminalSession } from '../../shared/types.js';
import type { PtyManager } from '../pty.js';
import type { LaunchPrincipalRef } from './types.js';

export type TerminalLaunchOptions = Parameters<PtyManager['create']>[0];

/** Main-owned launch seam. Callers identify themselves; only coordinator may spawn. */
export type LaunchTerminal = (
  opts: TerminalLaunchOptions,
  principal: LaunchPrincipalRef
) => TerminalSession | Promise<TerminalSession>;
