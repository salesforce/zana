/**
 * Main-process module registry — lists each module's main module. Mirrors
 * the renderer registry; core's boot runs `setupAll` over this array and the
 * IPC layer dispatches `modules:call` against it. Add a module = one line.
 */

import type { MainModule } from '../../shared/module-main.js';
import { slackMainModule } from '../../../plugins/slack/main/slack-main.js';

// Zana is no longer compiled in; it ships as a disk extension, loaded
// out-of-process through the runtime extension pipeline (discovery → consent →
// utilityProcess → broker). See extensions/zana/.
// zana in particular reaches its ticket/sprint/artifact/profile DATA through the
// host MCP pool over the brokered `mcp` capability (no more native
// better-sqlite3 across the utilityProcess boundary). slack STAYS a built-in
// (it needs in-process timers for the live-bot poll loop and a trusted
// ctx.fetch; promoted from a disk extension — see plugins/slack/).
export const MAIN_MODULES: MainModule[] = [slackMainModule];
