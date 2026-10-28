import { useRef, type CSSProperties, type ReactNode } from 'react';
import { DEFAULT_SPLIT_RATIO, MIN_SPLIT_RATIO, MAX_SPLIT_RATIO } from '../../lib/agent-script-split.js';
import { ResizeHandle, usePaneSize } from './studio/StudioResize.js';

/** Keeps the iframe mounted while switching between editor, tools and split views. */
export function AgentforceStudioSplit({ editor, children, open, mode = 'split', storageKey }: {
  editor: ReactNode; children: ReactNode; open: boolean; mode?: 'split' | 'editor' | 'panel'; storageKey?: string;
}) {
  const pane = usePaneSize(storageKey, DEFAULT_SPLIT_RATIO, MIN_SPLIT_RATIO, MAX_SPLIT_RATIO);
  const workspace = useRef<HTMLDivElement>(null);
  return <div ref={workspace} className="af-workspace" data-panel-open={open} data-mode={mode} style={{ '--af-editor-ratio': pane.size } as CSSProperties}>
    <div className="sf-as-stage">{editor}</div>
    {open && mode === 'split' && <ResizeHandle key={storageKey} className="af-workspace-divider" label="Resize editor and side panel" value={pane.size * 100}
      min={MIN_SPLIT_RATIO * 100} max={MAX_SPLIT_RATIO * 100} step={4}
      valueText={`${Math.round(pane.size * 100)}% editor, ${Math.round((1 - pane.size) * 100)}% side panel`}
      scale={() => { const width = workspace.current?.getBoundingClientRect().width ?? 0; return width > 9 ? 100 / (width - 9) : 0; }}
      onChange={value => pane.onChange(value / 100)} onCommit={value => pane.onCommit(value / 100)} onReset={pane.onReset} />}
    {children}
  </div>;
}
