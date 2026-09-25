import { PROJECT_ICONS, type ProjectIcon } from '@zana-ai/zcc-domain';
import { resolveIcon } from '../../lib/resolveIcon.js';

export function ProjectIconPicker({ value, onChange }: {
  value?: ProjectIcon;
  onChange(icon: ProjectIcon): void;
}) {
  return <div className="project-menu-icons" role="group" aria-label="Project icon">
    {PROJECT_ICONS.map(icon => {
      const Icon = resolveIcon(icon);
      const label = icon.replace(/([a-z])([A-Z0-9])/g, '$1 $2');
      return <button key={icon} type="button" title={label} aria-label={`Use ${label} icon`}
        aria-pressed={(value ?? 'Circle') === icon} onClick={() => onChange(icon)}>
        <Icon size={16} aria-hidden />
      </button>;
    })}
  </div>;
}
