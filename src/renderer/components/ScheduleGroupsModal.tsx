import { useEffect, useRef, useState } from 'react';
import { X, Plus, Trash2, Pencil, Check } from 'lucide-react';
import type { ScheduleGroup } from '@shared/types';
import { useScheduleGroups, useScheduler, useUi } from '../store';
import {
  groupIcon,
  GROUP_ICON_NAMES,
  GROUP_COLORS,
  GROUP_FALLBACK_COLOR
} from './scheduleGroupMeta';

/**
 * Manage schedule groups (the "Personal" / "Work" buckets for global
 * schedules). CRUD over `~/.zcc/groups.json` via the scheduler.groups
 * IPC surface. Deleting a group never deletes its schedules — they fall back
 * to the Ungrouped bucket — so the confirm copy says exactly that.
 */
export function ScheduleGroupsModal({ onClose }: { onClose: () => void }) {
  const groups = useScheduleGroups((s) => s.groups);
  const tasks = useScheduler((s) => s.tasks);
  const pushToast = useUi((s) => s.pushToast);
  const [editing, setEditing] = useState<ScheduleGroup | 'new' | null>(null);

  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    node.addEventListener('keydown', onKey);
    node.focus();
    return () => node.removeEventListener('keydown', onKey);
  }, [onClose]);

  const countFor = (gid: string) =>
    tasks.filter((t) => (!t.source || t.source === 'global') && t.group === gid).length;

  const remove = async (g: ScheduleGroup) => {
    const result = await window.cc.scheduler.groups.delete(g.id);
    if (!result.ok) pushToast(`Delete failed: ${result.message}`, 'error');
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={ref}
        className="modal scheduler-groups-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Manage schedule groups"
        tabIndex={-1}
      >
        <header className="modal-header">
          <h3>Schedule groups</h3>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </header>
        <div className="modal-body scheduler-groups-body">
          {editing ? (
            <GroupEditor
              group={editing === 'new' ? null : editing}
              onDone={() => setEditing(null)}
            />
          ) : (
            <>
              <p className="settings-help">
                Groups organise your global (non-project) schedules — e.g.
                Personal vs Work. Deleting a group keeps its schedules; they
                move to Ungrouped.
              </p>
              {groups.length === 0 ? (
                <div className="scheduler-empty">
                  <div className="scheduler-empty-title">No groups yet</div>
                  <div className="scheduler-empty-hint">
                    Create one to start sorting your personal schedules.
                  </div>
                </div>
              ) : (
                <ul className="scheduler-groups-list">
                  {groups.map((g) => {
                    const Icon = groupIcon(g.icon);
                    const count = countFor(g.id);
                    return (
                      <li key={g.id} className="scheduler-groups-row">
                        <Icon
                          size={16}
                          style={{ color: g.color ?? GROUP_FALLBACK_COLOR }}
                        />
                        <span className="scheduler-groups-row-name">{g.name}</span>
                        <span className="scheduler-groups-row-count">
                          {count} {count === 1 ? 'schedule' : 'schedules'}
                        </span>
                        <button
                          className="scheduler-icon-btn"
                          onClick={() => setEditing(g)}
                          title="Edit group"
                          aria-label="Edit group"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          className="scheduler-icon-btn scheduler-icon-btn--danger"
                          onClick={() => remove(g)}
                          title="Delete group"
                          aria-label="Delete group"
                        >
                          <Trash2 size={14} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </div>
        {!editing && (
          <footer className="modal-footer scheduler-groups-footer">
            <button className="btn primary" onClick={() => setEditing('new')}>
              <Plus size={14} /> New group
            </button>
          </footer>
        )}
      </div>
    </div>
  );
}

function GroupEditor({
  group,
  onDone
}: {
  group: ScheduleGroup | null;
  onDone: () => void;
}) {
  const pushToast = useUi((s) => s.pushToast);
  const selectGroup = useUi((s) => s.selectGroup);
  const [name, setName] = useState(group?.name ?? '');
  const [color, setColor] = useState(group?.color ?? GROUP_COLORS[0]);
  const [icon, setIcon] = useState(group?.icon ?? GROUP_ICON_NAMES[0]);
  const [saving, setSaving] = useState(false);
  const isNew = group === null;
  const canSave = name.trim().length > 0;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    if (isNew) {
      const result = await window.cc.scheduler.groups.create({ name: name.trim(), color, icon });
      if (!result.ok) {
        pushToast(`Create failed: ${result.message}`, 'error');
        setSaving(false);
        return;
      }
      // Jump straight into the new group's tab so the user can start adding.
      selectGroup(result.value.id);
    } else {
      const result = await window.cc.scheduler.groups.update(group.id, {
        name: name.trim(),
        color,
        icon
      });
      if (!result.ok) {
        pushToast(`Save failed: ${result.message}`, 'error');
        setSaving(false);
        return;
      }
    }
    onDone();
  };

  return (
    <div className="scheduler-group-editor">
      <div className="scheduler-form-field">
        <label htmlFor="group-name">Name</label>
        <input
          id="group-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          placeholder="Personal"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canSave && !saving) void save();
          }}
        />
      </div>
      <div className="scheduler-form-field">
        <label>Color</label>
        <div className="scheduler-color-picker">
          {GROUP_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={`scheduler-color-swatch ${color === c ? 'is-active' : ''}`}
              style={{ background: c }}
              onClick={() => setColor(c)}
              aria-label={`Color ${c}`}
            >
              {color === c && <Check size={12} />}
            </button>
          ))}
        </div>
      </div>
      <div className="scheduler-form-field">
        <label>Icon</label>
        <div className="scheduler-icon-picker">
          {GROUP_ICON_NAMES.map((nm) => {
            const Icon = groupIcon(nm);
            return (
              <button
                key={nm}
                type="button"
                className={`scheduler-icon-swatch ${icon === nm ? 'is-active' : ''}`}
                style={icon === nm ? { color, borderColor: color } : undefined}
                onClick={() => setIcon(nm)}
                aria-label={`Icon ${nm}`}
                title={nm}
              >
                <Icon size={16} />
              </button>
            );
          })}
        </div>
      </div>
      <div className="scheduler-group-editor-actions">
        <button className="btn" onClick={onDone}>Cancel</button>
        <button className="btn primary" onClick={save} disabled={!canSave || saving}>
          {saving ? 'Saving…' : isNew ? 'Create group' : 'Save changes'}
        </button>
      </div>
    </div>
  );
}
