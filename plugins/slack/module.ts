/**
 * Slack app-module manifest (renderer side). Declares the nav entry and panel;
 * core's renderer registry imports this and wires it into the sidebar + shell.
 */

import type { AppModule } from '@zana-ai/zcc-extension-sdk/renderer';
import SlackPanel from './renderer/SlackPanel';
import SlackBot from './renderer/SlackBot';

export const slackModule: AppModule = {
  id: 'slack',
  title: 'Slack',
  icon: 'MessageSquare',
  // Slack is configuration, not a top-level tool — it lives as a Settings
  // sub-section (a row in the Settings list), not a sidebar "Extensions" entry.
  // The background bot still runs regardless of placement.
  placement: 'settings',
  panel: SlackPanel,
  // Headless, always-mounted: the live-bot launch/reply bridges + lifecycle
  // notify. Must live here (not in the panel) so they keep running when the
  // user navigates away from the Slack tab. See SlackBot.tsx / ModuleBackgroundHost.
  background: SlackBot,
  // ADVISORY ONLY as a built-in: built-ins bypass the renderer permission gate
  // entirely (see diskExtLacks in src/renderer/modules/host.ts, which returns
  // false for non-disk-ext ids), so none of these are enforced. They remain as
  // documentation of intent + forward-compat if slack ever ships as a disk ext
  // again. See AppModule.permissions.
  // `projects:read` + `session:launch` back the live-bot launch-bridge;
  // `session:reply` lets it answer approval prompts / forward hints to a session.
  permissions: [
    'storage',
    'net',
    'inbox:push',
    'external:open',
    'projects:read',
    'session:launch',
    'session:reply'
  ]
};
