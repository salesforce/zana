import { useSyncExternalStore } from 'react';
import type { PluginAppEntry } from '@zana-ai/zcc-domain/product';
import { Link } from 'react-router-dom';
import { getPluginRegistrationSets, subscribePluginSlots } from '@/plugins/plugin-slots';
import { getSkillsRoutePath } from '@/lib/route-paths';

function slotLinesFromSet(set: ReturnType<typeof getPluginRegistrationSets>[number] | undefined): string[] {
  if (!set) return [];
  const lines: string[] = [];
  if (set.navPanels.length) {
    const sidebar = set.navPanels.filter((panel) => panel.placement !== 'extensions').length;
    const hub = set.navPanels.filter((panel) => panel.placement === 'extensions').length;
    if (sidebar) lines.push(`Sidebar panels (${sidebar})`);
    if (hub) lines.push(`Plugins hub pages (${hub})`);
  }
  if (set.projectTabs.length) lines.push(`Project tabs (${set.projectTabs.length})`);
  if (set.projectMenuActions.length) lines.push(`Project menus (${set.projectMenuActions.length})`);
  if (set.settingsSections.length) lines.push(`Settings sections (${set.settingsSections.length})`);
  if (set.homepageSections.length) lines.push(`Home sections (${set.homepageSections.length})`);
  if (set.sidebarFooterActions.length) lines.push(`Sidebar footer actions (${set.sidebarFooterActions.length})`);
  if (set.threadPanelActions.length) lines.push(`Side-panel tabs (${set.threadPanelActions.length})`);
  if (set.pendingInteractions.length) lines.push(`Pending interactions (${set.pendingInteractions.length})`);
  if (set.timelineRenderers.length) lines.push(`Timeline renderers (${set.timelineRenderers.length})`);
  if (set.commandPaletteActions.length) lines.push(`Command palette (${set.commandPaletteActions.length})`);
  if (set.newThreadPanelActions.length) lines.push(`New-thread actions (${set.newThreadPanelActions.length})`);
  if (set.threadLists.length) lines.push(`Agents list (${set.threadLists.length})`);
  if (set.threadHeaderActions.length) lines.push(`Thread header (${set.threadHeaderActions.length})`);
  if (set.composerCustomizations.length) lines.push(`Composer customizations (${set.composerCustomizations.length})`);
  if (set.contentScripts.length) lines.push(`Content scripts (${set.contentScripts.length})`);
  if (set.messageDirectives.length) lines.push(`Message directives (${set.messageDirectives.length})`);
  if (set.messageActions.length) lines.push(`Message actions (${set.messageActions.length})`);
  if (set.fileOpeners.length) lines.push(`File openers (${set.fileOpeners.length})`);
  if (set.agentCardActions.length) lines.push(`Agent card actions (${set.agentCardActions.length})`);
  if (set.agentsBoardActions.length) lines.push(`Agents board actions (${set.agentsBoardActions.length})`);
  return lines;
}

export function PluginHubIncludes({ plugin }: { plugin: PluginAppEntry }) {
  const sets = useSyncExternalStore(subscribePluginSlots, getPluginRegistrationSets, getPluginRegistrationSets);
  const lines = slotLinesFromSet(sets.find((row) => row.pluginId === plugin.id));
  const skills = plugin.skillNames ?? [];
  const mcp = plugin.mcpServers ?? [];
  const cli = plugin.cliNames ?? [];
  if (lines.length === 0 && skills.length === 0 && mcp.length === 0 && cli.length === 0) {
    return null;
  }
  return (
    <section className="settings-section" data-testid="plugin-includes">
      <h3>Includes</h3>
      {lines.length > 0 ? (
        <ul className="ext-hub-perm-list">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
      {skills.length > 0 ? (
        <p className="settings-help">
          Skills:{' '}
          {skills.map((name, index) => (
            <span key={name}>
              {index > 0 ? ', ' : null}
              <Link to={`${getSkillsRoutePath()}?q=${encodeURIComponent(name)}`}>{name}</Link>
            </span>
          ))}
        </p>
      ) : null}
      {cli.length > 0 ? <p className="settings-help">CLI: {cli.map((name) => `zcc ${name}`).join(', ')}</p> : null}
      {mcp.length > 0 ? (
        <p className="settings-help">MCP: {mcp.map((server) => server.name).join(', ')}</p>
      ) : null}
    </section>
  );
}
