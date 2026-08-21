import type { TerminalSession } from '@zana-ai/zcc-domain/product';
import type { PtyManager } from '@zana-ai/zcc-host-daemon/pty';
import type { LaunchPrincipalRef } from './types.js';

export type TerminalLaunchOptions = Parameters<PtyManager['create']>[0];

/** Main-owned launch seam. Callers identify themselves; only coordinator may spawn. */
export type LaunchTerminal = (
  opts: TerminalLaunchOptions,
  principal: LaunchPrincipalRef
) => TerminalSession | Promise<TerminalSession>;
