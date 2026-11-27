import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Grip, Maximize2, Plus } from 'lucide-react';
import type { PluginHomepageSectionRegistration } from '@zana-ai/zcc-plugin-sdk/app';
import { WidgetDialog } from './WidgetDialog.js';
import { WidgetContent, pluginSource } from './WidgetContent.js';
import { GRID_GAP, GRID_ROW_HEIGHT, useGridColumns, useWidgetGrid } from './useWidgetGrid.js';
import { HOME_WIDGETS_KEY, MAX_WIDGETS, layoutBottom, newWidget, placeWidgets, readWidgets, saveLayout, type HomeWidget, type Placement, type WidgetDraft } from './model.js';
import './home-widgets.css';

export function loadHomeWidgets() {
  try { return readWidgets(localStorage.getItem(HOME_WIDGETS_KEY)); }
  catch { return []; }
}

export function HomeWidgets({ plugins, widgets, onChange }: {
  plugins: readonly PluginHomepageSectionRegistration[];
  widgets: HomeWidget[];
  onChange: (widgets: HomeWidget[]) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [dialog, setDialog] = useState<'add' | HomeWidget | null>(null);
  const [message, setMessage] = useState('');
  const [saveError, setSaveError] = useState(false);
  const id = useId();
  const grid = useRef<HTMLDivElement>(null);
  const focusAfterChange = useRef<HTMLElement | null>(null);
  const columns = useGridColumns(grid);
  const layout = useMemo(() => placeWidgets(widgets, columns), [widgets, columns]);
  const pluginsBySource = useMemo(() => new Map(plugins.map(plugin => [pluginSource(plugin), plugin])), [plugins]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== HOME_WIDGETS_KEY) return;
      const next = readWidgets(event.newValue);
      if (!next.length) setEditing(false);
      onChange(next);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [onChange]);

  useLayoutEffect(() => {
    const control = focusAfterChange.current;
    focusAfterChange.current = null;
    if (control?.isConnected) control.focus({ preventScroll: true });
  }, [widgets]);

  function persist(next: HomeWidget[]) {
    try {
      localStorage.setItem(HOME_WIDGETS_KEY, JSON.stringify(next));
      setSaveError(false);
    } catch {
      setSaveError(true);
    }
    onChange(next);
  }

  const { controls, preview } = useWidgetGrid(grid, columns, layout, change => {
    const old = layout.get(change.id);
    if (!old || (old.column === change.column && old.row === change.row && old.width === change.width && old.height === change.height)) return;
    const chosen = widgets.find(widget => widget.id === change.id);
    if (!chosen) return;
    const next = widgets.map(widget => widget.id === change.id && change.kind === 'resize' ? {
      ...widget, width: old.width === change.width ? widget.width : change.width, height: change.height
    } : widget);
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && focused.closest('[data-widget-id]')?.getAttribute('data-widget-id') === change.id) {
      focusAfterChange.current = focused;
    }
    persist(saveLayout(next, columns, placeWidgets(next, columns, change, layout)));
    setMessage(change.kind === 'move'
      ? `${chosen.title} moved to column ${change.column + 1}, row ${change.row + 1}.`
      : `${chosen.title} resized to ${change.width} columns by ${change.height} rows.`);
  });

  const ordered = [...widgets].sort((a, b) => {
    const first = layout.get(a.id)!;
    const second = layout.get(b.id)!;
    return first.row - second.row || first.column - second.column;
  });
  const gridStyle = {
    '--widget-columns': columns,
    '--widget-row': `${GRID_ROW_HEIGHT}px`,
    '--widget-gap': `${GRID_GAP}px`
  } as CSSProperties;

  function saveDraft(draft: WidgetDraft) {
    if (dialog === 'add' && widgets.length < MAX_WIDGETS) {
      persist([...widgets, newWidget(crypto.randomUUID(), draft)]);
      setMessage(`${draft.title} pinned to Home.`);
    } else if (dialog && dialog !== 'add') {
      persist(widgets.map(widget => widget.id === dialog.id ? { ...widget, ...draft } : widget));
      setMessage(`${draft.title} updated.`);
    }
    setDialog(null);
  }

  return <section className="home-widgets" aria-labelledby={`${id}-heading`}>
    <div className="home-widgets-head">
      <h2 id={`${id}-heading`}>My widgets</h2>
      <div>
        {widgets.length > 0 && <button type="button" className="home-widget-btn" aria-pressed={editing}
          onClick={() => setEditing(value => !value)}>{editing ? 'Done' : 'Edit layout'}</button>}
        <button type="button" className="home-widget-btn" onClick={() => setDialog('add')} disabled={widgets.length >= MAX_WIDGETS}><Plus size={15} /> Add widget</button>
      </div>
    </div>
    {editing && <p className="home-widget-message" id={`${id}-instructions`}>Drag a widget by its title. Drag its corner to resize. You can also use the arrow keys on either handle.</p>}
    {saveError && <p role="alert" className="home-widget-message">This window couldn’t save your widgets. Changes may be lost after a reload.</p>}
    <div ref={grid} className="home-widget-grid" data-editing={editing} style={gridStyle}>
      {ordered.map(widget => {
        const box = layout.get(widget.id)!;
        return <article key={widget.id} aria-label={widget.title} className="home-widget-card" style={placementStyle(box)}
          data-widget-id={widget.id} data-moving={preview?.id === widget.id}>
          <header>
            <h3>{editing
              ? <button type="button" className="home-widget-handle" aria-label={`Move ${widget.title} on grid`}
                aria-describedby={`${id}-instructions`} {...controls(widget.id, 'move')}><Grip size={15} />{widget.title}</button>
              : widget.title}</h3>
            {editing && <button type="button" className="home-widget-btn" aria-label={`Edit ${widget.title}`} onClick={() => setDialog(widget)}>Edit</button>}
          </header>
          <div className="home-widget-content">
            <WidgetContent widget={widget} plugin={pluginsBySource.get(widget.source)}
              onContent={content => persist(widgets.map(item => item.id === widget.id ? { ...item, content } : item))} />
          </div>
          {editing && <>
            <span className="home-widget-size">{box.width} × {box.height}</span>
            <button type="button" className="home-widget-resize" aria-label={`Resize ${widget.title}`}
              aria-describedby={`${id}-instructions`} {...controls(widget.id, 'resize')}><Maximize2 size={14} /></button>
          </>}
        </article>;
      })}
      {editing && widgets.length > 0 && <div aria-hidden="true" style={{ gridColumn: '1 / -1', gridRow: `${layoutBottom(layout) + 1} / span 2` }} />}
      {preview && <div aria-hidden="true" className="home-widget-drop" style={placementStyle(preview)}>
        {preview.kind === 'move' ? 'Drop here' : `${preview.width} × ${preview.height}`}
      </div>}
    </div>
    <span className="sr-only" role="status">{message}</span>
    {dialog && <WidgetDialog plugins={plugins} existing={dialog === 'add' ? null : dialog} onClose={() => setDialog(null)} onSave={saveDraft}
      onRemove={() => {
        if (dialog === 'add') return;
        const next = widgets.filter(widget => widget.id !== dialog.id);
        persist(next);
        if (!next.length) setEditing(false);
        setMessage(`${dialog.title} removed from Home.`);
        setDialog(null);
      }} />}
  </section>;
}

function placementStyle(box: Placement): CSSProperties {
  return {
    gridColumn: `${box.column + 1} / span ${box.width}`,
    gridRow: `${box.row + 1} / span ${box.height}`
  };
}
