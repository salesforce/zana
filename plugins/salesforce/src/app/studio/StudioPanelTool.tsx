import { useEffect, useRef, type ComponentType } from 'react';
import { useZccContext, type PluginThreadPanelProps } from '@zana-ai/zcc-plugin-sdk/app';
import { EmptyState } from '../components/SalesforceState.js';
import { STUDIO_TOKENS } from './studio-tokens.js';
import { attachStudioTool, useStudioMounted, useStudioToolScope, type PanelTool } from './studio-tool-bridge.js';

const HOST_STYLES = `${STUDIO_TOKENS}
.sf-panel-tool-host { display:flex; flex-direction:column; height:100%; min-height:0; background:var(--sf-surface); color:var(--sf-text); }
.sf-panel-tool-slot { display:flex; flex:1 1 auto; min-height:0; min-width:0; overflow:hidden; }
.sf-panel-tool-slot[hidden] { display:none; }
`;

/** The host side-panel tab for one Studio tool; Studio renders the content (studio-tool-bridge). */
export function StudioPanelTool({ tool, title, projectId, tabId, studioId }: { tool: PanelTool; title: string; projectId?: string; tabId?: string; studioId?: string }) {
  const context = useZccContext();
  // Restored host tabs follow the runtime in this window, not their previous window.
  const owner = context.sidePanel === true ? context.surface === 'plugin-view' ? context.resourceId ?? 'window' : undefined : studioId;
  const key = useStudioToolScope(projectId, owner);
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
  const Tool = (props: PluginThreadPanelProps) => {
    const studioId = props.params && typeof props.params === 'object' && !Array.isArray(props.params) && typeof props.params.studioId === 'string' ? props.params.studioId : undefined;
    return <StudioPanelTool tool={tool} title={title} projectId={props.projectId} tabId={props.tabId} studioId={studioId} />;
  };
  Tool.displayName = `StudioPanelTool(${tool})`;
  return Tool;
}
