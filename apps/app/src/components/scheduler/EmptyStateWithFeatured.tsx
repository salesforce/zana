import React, { useMemo } from 'react';
import { Clock, Plus } from 'lucide-react';
import type { ScheduleTemplate } from '@zana-ai/zcc-domain/product';
import { useScheduleTemplates } from '../../store.js';
import { templateIcon, PROFILE_LABEL } from './schedulerUtils.js';

interface EmptyStateWithFeaturedProps {
  onPick: (template: ScheduleTemplate) => void;
  onCreateBlank: () => void;
}

export function EmptyStateWithFeatured({ onPick, onCreateBlank }: EmptyStateWithFeaturedProps) {
  const templates = useScheduleTemplates((s) => s.templates);
  const featured = useMemo(
    () => templates.filter((t) => t.source === 'builtin').slice(0, 3),
    [templates]
  );
  return (
    <div className="scheduler-empty">
      <Clock size={28} className="scheduler-empty-icon" />
      <div className="scheduler-empty-title">No schedules yet</div>
      <div className="scheduler-empty-hint">
        Start from a template, or click{' '}
        <button
          className="settings-btn settings-btn--primary"
          onClick={onCreateBlank}
          style={{ marginLeft: 6 }}
        >
          <Plus size={12} /> New schedule
        </button>
      </div>
      {featured.length > 0 && (
        <div className="scheduler-featured">
          <div className="scheduler-featured-title">Featured templates</div>
          <ul className="scheduler-featured-grid scheduler-template-grid">
            {featured.map((t) => {
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
        </div>
      )}
    </div>
  );
}
