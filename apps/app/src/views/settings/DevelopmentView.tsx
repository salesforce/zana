import type { AppConfig } from '@zana-ai/zcc-domain/product';
import { Section, CheckboxField } from '@/components/settings/FormFields';

export function DevelopmentView({ config, onUpdate }: {
  config: AppConfig;
  onUpdate: (patch: Partial<AppConfig>) => void;
}) {
  return (
    <Section searchId="development.bundled-plugins" anchorId="bundled-plugins" title="Bundled plugins" help="Develop and test bundled plugins on this instance.">
      <CheckboxField searchId="development.plugin-development" label="Bundled plugin development"
        help="Allow local source folders to override bundled plugins and automatically rebuild bundled plugins when their sources change. Applies immediately. Turning this off stops source watching and blocks further overrides; currently loaded plugins keep running."
        checked={config.pluginDevelopmentEnabled ?? false} onChange={v => onUpdate({ pluginDevelopmentEnabled: v })} />
    </Section>
  );
}
