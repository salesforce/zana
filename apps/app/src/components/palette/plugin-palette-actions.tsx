import type { PluginCommandPaletteActionRegistration } from '@zana-ai/zcc-plugin-sdk';
import type { JsonValue } from '@zana-ai/zcc-domain/thread-runtime';
import { Puzzle } from 'lucide-react';
import { appNavigate } from '../../lib/app-navigate.js';
import { getPluginPanelRoutePath } from '../../lib/route-paths.js';
import { openPluginThreadPanel } from '../../plugins/plugin-thread-panel.js';
import type { PaletteItem } from './buildItems.js';

export interface PluginPaletteActionContext {
  threadId: string | null;
  projectId: string | null;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function buildPluginPaletteItems(
  slots: readonly PluginCommandPaletteActionRegistration[],
  ctx: PluginPaletteActionContext,
  onClose: () => void
): PaletteItem[] {
  const items: PaletteItem[] = [];
  for (const slot of slots) {
    const context = {
      threadId: ctx.threadId,
      projectId: ctx.projectId,
      openPanel: (options: { actionId: string; title?: string; params?: JsonValue }) =>
        openPluginThreadPanel({
          pluginId: slot.pluginId,
          threadId: ctx.threadId,
          actionId: options.actionId,
          title: options.title,
          params: options.params ?? null
        }),
      toPluginPanel: (path: string, options?: { subPath?: string; replace?: boolean }) =>
        appNavigate(getPluginPanelRoutePath({ pluginId: slot.pluginId, path, subPath: options?.subPath }), {
          replace: options?.replace
        })
    };
    if (slot.isAvailable !== undefined) {
      let available: boolean;
      try {
        available = slot.isAvailable(context);
      } catch (error) {
        console.warn(
          `[plugin:${slot.pluginId}] commandPaletteAction "${slot.id}" isAvailable failed: ${describeError(error)}`
        );
        continue;
      }
      if (!available) continue;
    }
    items.push({
      key: `plugin:${slot.pluginId}/${slot.id}`,
      icon: <Puzzle size={14} />,
      label: slot.title,
      hint: slot.pluginId,
      category: 'Extensions',
      source: slot.pluginId,
      run: () => {
        onClose();
        const warn = (error: unknown) => {
          console.warn(
            `[plugin:${slot.pluginId}] commandPaletteAction "${slot.id}" failed: ${describeError(error)}`
          );
        };
        try {
          const result = slot.run(context);
          if (result instanceof Promise) void result.catch(warn);
        } catch (error) {
          warn(error);
        }
      }
    });
  }
  return items;
}
