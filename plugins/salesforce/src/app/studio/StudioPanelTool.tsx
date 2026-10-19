import { useEffect, useRef, type ComponentType } from 'react';
import type { PluginThreadPanelProps } from '@zana-ai/zcc-plugin-sdk/app';
import { EmptyState } from '../components/SalesforceState.js';
import { STUDIO_TOKENS } from './studio-tokens.js';
import { attachStudioTool, useStudioMounted, type PanelTool } from './studio-tool-bridge.js';

const HOST_STYLES = `${STUDIO_TOKENS}
.sf-panel-tool-host { display:flex; flex-direction:column; height:100%; min-height:0; background:var(--sf-surface); color:var(--sf-text); }
.sf-panel-tool-slot { display:flex; flex:1 1 auto; min-height:0; min-width:0; }
.sf-panel-tool-slot[hidden] { display:none; }
`;

/** The host side-panel tab for one Studio tool; Studio renders the content (studio-tool-bridge). */
export function StudioPanelTool({ tool, title, projectId, tabId }: { tool: PanelTool; title: string; projectId?: string; tabId?: string }) {
  const key = projectId ?? '';
  const mounted = useStudioMounted(key);
  const slot = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = slot.current;
    return container ? attachStudioTool(key, tool, container, tabId) : undefined;
  }, [key, tool, tabId]);
  return <div className="sf-as sf-panel-tool-host" data-testid={`studio-panel-tool-${tool}`}>
    <style>{HOST_STYLES}</style>
    {!mounted && <EmptyState art="code" title={`${title} needs Agent Script Studio`}>Open Agentforce in this Salesforce tab to use {title} here.</EmptyState>}
    <div ref={slot} className="sf-panel-tool-slot" hidden={!mounted} />
  </div>;
}

/** The thread-panel action component for `tool`. */
export function studioPanelTool(tool: PanelTool, title: string): ComponentType<PluginThreadPanelProps> {
  const Tool = (props: PluginThreadPanelProps) => <StudioPanelTool tool={tool} title={title} projectId={props.projectId} tabId={props.tabId} />;
  Tool.displayName = `StudioPanelTool(${tool})`;
  return Tool;
}
