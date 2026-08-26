import { useState, useSyncExternalStore } from 'react';
import { PluginSlotBoundary } from './PluginSlotBoundary.js';
import { listNewThreadPanelActions, subscribePluginSlots } from './plugin-slots.js';
import { resolveIcon } from '../lib/resolveIcon.js';

export function PluginNewThreadActions({ projectId }: { projectId: string | null }) {
  const actions = useSyncExternalStore(
    subscribePluginSlots,
    listNewThreadPanelActions,
    listNewThreadPanelActions
  );
  const [openId, setOpenId] = useState<string | null>(null);
  if (actions.length === 0) return null;
  const open = actions.find((row) => `${row.pluginId}/${row.id}` === openId);
  return (
    <div className="new-thread-plugin-actions" data-testid="new-thread-plugin-actions">
      <div className="new-thread-plugin-action-list">
        {actions.map((action) => {
          const Icon = resolveIcon(action.icon);
          const key = `${action.pluginId}/${action.id}`;
          return (
            <button
              key={`${key}:${action.generation}`}
              type="button"
              data-testid={`new-thread-plugin-${action.pluginId}-${action.id}`}
              className={openId === key ? 'is-active' : undefined}
              onClick={() => {
                void action.run?.({
                  projectId,
                  openPanel: (options) => {
                    void options;
                    setOpenId(key);
                  }
                });
                setOpenId(key);
              }}
            >
              <Icon size={14} /> {action.title}
            </button>
          );
        })}
      </div>
      {open ? (
        <PluginSlotBoundary pluginId={open.pluginId} generation={open.generation}>
          <div
            className={`thread-plugin-tab ${open.layout === 'flush' ? 'is-flush' : 'is-padded'}`}
            data-testid="new-thread-plugin-panel"
          >
            <open.component pluginId={open.pluginId} projectId={projectId} params={null} />
          </div>
        </PluginSlotBoundary>
      ) : null}
    </div>
  );
}
