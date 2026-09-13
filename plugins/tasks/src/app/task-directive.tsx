import { useZccNavigate, type PluginMessageDirectiveProps } from '@zana-ai/zcc-plugin-sdk/app';
import { useEffect, useState } from 'react';
import { useRpc } from '@zana-ai/zcc-plugin-sdk/app';
import type { PublicTask } from '../model.js';
import { StatusIcon } from './icons.js';

export function TaskDirectiveCard(props: PluginMessageDirectiveProps) {
  const rpc = useRpc();
  const navigate = useZccNavigate();
  const key = props.attributes.key || props.attributes.id || '';
  const fallback = props.attributes.title || key || 'Task';
  const [task, setTask] = useState<PublicTask | null>(null);

  useEffect(() => {
    if (!key) return;
    void rpc
      .call('get', { key })
      .then((result) => {
        const row = result as { task?: PublicTask };
        if (row?.task) setTask(row.task);
      })
      .catch(() => undefined);
  }, [key, rpc]);

  const title = task?.title ?? fallback;
  const status = task?.status ?? 'todo';
  const label = task?.key ?? key;
  return (
    <button
      type="button"
      className="tsk-directive"
      onClick={() => {
        if (label) navigate.toPluginPanel('main', { subPath: `task/${label}` });
      }}
    >
      <StatusIcon status={status} />
      <span className="tsk-directive-key">{label}</span>
      <span className="tsk-directive-title">{title}</span>
    </button>
  );
}
