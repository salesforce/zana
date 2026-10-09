import { useEffect } from 'react';
import { useZccNavigate, type PluginMessageDirectiveProps } from '@zana-ai/zcc-plugin-sdk/app';
import type { SalesforceOperation } from '../../../lib/workbench-contract.js';
import { CARD_STYLES, ErrorCard, Pill, cleanAttr, rpc, rpcFailure, useLoaded, type Tone } from './card-kit.js';

export const OPERATION_POLL_MS = 3000;

const STATE_TONE: Record<SalesforceOperation['state'], Tone> = { running: 'running', submitted: 'running', succeeded: 'success', failed: 'danger', interrupted: 'warn' };
const STATE_LABEL: Record<SalesforceOperation['state'], string> = { running: 'Running', submitted: 'Submitted', succeeded: 'Succeeded', failed: 'Failed', interrupted: 'Interrupted' };

type Found = { operation: SalesforceOperation } | { missing: true };

/** `::sf-operation{id="…"}` — a live card for a Salesforce workbench operation. */
export function OperationCard({ pluginId, attributes, source, message }: PluginMessageDirectiveProps) {
  const navigate = useZccNavigate();
  const id = cleanAttr(attributes.id, 128);
  const projectId = message.projectId;
  const loaded = useLoaded<Found>(async () => {
    const result = await rpc(pluginId, 'operations.list', { ...(projectId ? { projectId } : {}), threadId: message.threadId });
    const failure = rpcFailure(result);
    if (failure) throw new Error(failure.message);
    const operation = (result as { operations?: SalesforceOperation[] }).operations?.find(row => row.id === id);
    return operation ? { operation } : { missing: true };
  }, [pluginId, id, projectId, message.threadId]);
  const operation = loaded.data && 'operation' in loaded.data ? loaded.data.operation : null;
  const running = operation?.state === 'running';
  const { reload } = loaded;
  useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(reload, OPERATION_POLL_MS);
    return () => clearInterval(timer);
  }, [running, reload]);

  if (!id) return <ErrorCard kind="operation" message="Invalid operation link: an id is required." source={source} />;
  if (loaded.error && !operation) return <ErrorCard kind="operation" message={`Operation unavailable: ${loaded.error}`} source={source} />;
  if (loaded.data && 'missing' in loaded.data) return <ErrorCard kind="operation" message="Operation not found in this project." source={source} />;

  const open = () => navigate.openThreadPanel({
    actionId: 'sf-operations',
    title: 'Operations',
    params: { version: 1, operationId: id, ...(projectId ? { projectId } : {}) },
    ...(message.threadId ? { threadId: message.threadId } : {})
  });
  return (
    <div className="plugin-directive-card sf-dcard" data-testid="sf-card-operation">
      <style>{CARD_STYLES}</style>
      <button type="button" className="plugin-directive-card-main" disabled={!operation} onClick={open} title="Open results in Operations">
        <span className="sf-dcard-icon" aria-hidden>OP</span>
        <span className="sf-dcard-body">
          <span className="sf-dcard-line">
            <span className="plugin-directive-card-kind">Operation</span>
            <span className="plugin-directive-card-title">{operation ? operation.title : 'Loading…'}</span>
            {operation ? <Pill tone={STATE_TONE[operation.state]}>{STATE_LABEL[operation.state]}</Pill> : null}
            {operation?.org?.alias ? <Pill>{operation.org.alias}</Pill> : null}
          </span>
          <span className="sf-dcard-sub">{operation ? operation.summary || operation.kind : 'Loading operation…'}</span>
        </span>
      </button>
    </div>
  );
}
