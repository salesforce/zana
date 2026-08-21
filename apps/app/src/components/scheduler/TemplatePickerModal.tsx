import React, { useState, useMemo } from 'react';
import { Sparkles, FolderOpen } from 'lucide-react';
import type { ScheduleTemplate } from '@zana-ai/zcc-domain/product';
import { useScheduleTemplates } from '../../store.js';
import { Modal } from '../Modal.js';
import { templateIcon, sourceLabel, PROFILE_LABEL } from './schedulerUtils.js';

interface TemplatePickerModalProps {
  onClose: () => void;
  onPick: (template: ScheduleTemplate) => void;
}

export function TemplatePickerModal({ onClose, onPick }: TemplatePickerModalProps) {
  const templates = useScheduleTemplates((s) => s.templates);
  const loading = useScheduleTemplates((s) => s.loading);
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter((t) => {
      const haystack = `${t.name} ${t.description ?? ''} ${t.category ?? ''}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [templates, query]);

  const grouped = useMemo(() => {
    const out = new Map<string, ScheduleTemplate[]>();
    for (const t of filtered) {
      const key = t.category ?? 'Uncategorized';
      const list = out.get(key) ?? [];
      list.push(t);
      out.set(key, list);
    }
    return [...out.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  const reveal = () => {
    window.cc.scheduler.revealTemplatesDir().catch(() => {});
  };

  return (
    <Modal
      title="Schedule templates"
      onClose={onClose}
      className="scheduler-template-modal"
      bodyClassName="scheduler-template-body"
      header={
        <>
          <div className="modal-header">
            <h3>Schedule templates</h3>
            <button className="icon-button" onClick={onClose} aria-label="Close">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <div className="scheduler-template-toolbar">
            <input
              className="scheduler-template-search"
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search templates…"
              autoFocus
            />
            <button
              className="settings-btn scheduler-template-folder-btn"
              onClick={reveal}
              title="Drop your own JSON templates in this folder"
            >
              <FolderOpen size={14} /> Open templates folder
            </button>
          </div>
        </>
      }
    >
      {loading ? (
        <div className="scheduler-empty">Loading templates…</div>
      ) : filtered.length === 0 ? (
        <div className="scheduler-empty">
          <Sparkles size={28} className="scheduler-empty-icon" />
          <div className="scheduler-empty-title">No matching templates</div>
          <div className="scheduler-empty-hint">
            Drop a JSON file in <code>~/.zcc/templates/</code> to add your own.
          </div>
        </div>
      ) : (
        grouped.map(([category, items]) => (
          <section key={category} className="scheduler-template-group">
            <h4 className="scheduler-template-group-title">{category}</h4>
            <ul className="scheduler-template-grid">
              {items.map((t) => {
                const Icon = templateIcon(t.icon);
                return (
                  <li key={t.id}>
                    <button
                      className="scheduler-template-card"
                      onClick={() => onPick(t)}
                    >
                      <div className="scheduler-template-card-head">
                        <span className="scheduler-template-icon">
                          <Icon size={16} />
                        </span>
                        <span className="scheduler-template-name">{t.name}</span>
                        <span className="scheduler-pill scheduler-pill--source">
                          {sourceLabel(t.source)}
                        </span>
                      </div>
                      {t.description && (
                        <p className="scheduler-template-desc">{t.description}</p>
                      )}
                      <div className="scheduler-template-meta">
                        <span className="scheduler-pill scheduler-pill--interval">
                          every {t.defaults.every}
                        </span>
                        <span className="scheduler-pill">
                          {PROFILE_LABEL[t.defaults.profile]}
                        </span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </Modal>
  );
}
