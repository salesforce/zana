import { useEffect, useRef } from 'react';
import { ensureAgentScriptMonaco } from './editor';
import { isHostToPlayground, PLAYGROUND_BRIDGE_SOURCE } from '../../src/app/playground-bridge';

/** Separate model: inspecting related source cannot replace or dirty the agent. */
export function ReferenceEditor() {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = ensureAgentScriptMonaco();
    const model = host.editor.createModel('', 'apex');
    const editor = host.editor.create(container.current!, { model, readOnly: true, domReadOnly: true, automaticLayout: true, minimap: { enabled: false }, fontSize: 13, scrollBeyondLastLine: false, wordWrap: 'on', padding: { top: 12 }, overviewRulerLanes: 0 });
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== window.parent || !isHostToPlayground(event.data)) return;
      const message = event.data;
      if (message.type === 'reference') {
        host.editor.setModelLanguage(model, message.language);
        model.setValue(message.content);
        if (message.line) { editor.revealLineInCenter(message.line); editor.setPosition({ lineNumber: message.line, column: 1 }); }
      }
      if (message.type === 'reference' || message.type === 'setTheme') host.editor.setTheme(message.theme === 'light' ? 'agentscript-light' : 'agentscript-dark');
    };
    window.addEventListener('message', onMessage);
    window.parent.postMessage({ source: PLAYGROUND_BRIDGE_SOURCE, type: 'ready' }, location.origin);
    return () => { window.removeEventListener('message', onMessage); editor.dispose(); model.dispose(); };
  }, []);
  return <div ref={container} style={{ width: '100%', height: '100%' }} data-testid="action-source-editor" />;
}
