import type { AppConfig } from '@zana-ai/zcc-domain/product';
import { BUNDLED_PRODUCT_SKILLS } from '@zana-ai/zcc-domain';
import { Section, CheckboxField } from '@/components/settings/FormFields';

function disabledSkillSet(config: AppConfig): Set<string> {
  return new Set(config.disabledBundledSkills ?? []);
}

export function AgentGuidanceSettings({
  config,
  onUpdate
}: {
  config: AppConfig;
  onUpdate: (patch: Partial<AppConfig>) => Promise<void>;
}) {
  const injectGuidance = config.injectProductGuidance !== false;
  const injectRemote = config.injectRemoteInstructions !== false;
  const injectSkills = config.injectBundledSkills !== false;
  const disabled = disabledSkillSet(config);

  return (
    <Section
      anchorId="agent-guidance"
      title="Agent guidance"
      help="These apply to the next launch. Already-running agents keep their current prompt and skills."
    >
      <CheckboxField
        label="Inject product introduction and RULES.md"
        help="Inbox, mesh, library, and follow-up guidance, plus ~/.zcc/RULES.md and project .zcc/RULES.md."
        checked={injectGuidance}
        onChange={(v) => onUpdate({ injectProductGuidance: v })}
      />
      <CheckboxField
        label="Inject remote-access instructions"
        help="Connect / remote tool-proxy instructions. Independent of the product introduction."
        checked={injectRemote}
        onChange={(v) => onUpdate({ injectRemoteInstructions: v })}
      />
      <CheckboxField
        label="Inject bundled skills"
        help="Shipped product skills (CLI, Inbox, Browser, …). Turning this off keeps per-skill picks."
        checked={injectSkills}
        onChange={(v) => onUpdate({ injectBundledSkills: v })}
      />
      <div className="settings-bundled-skills" data-testid="bundled-skills-opt-outs">
        {BUNDLED_PRODUCT_SKILLS.map((skill) => (
          <CheckboxField
            key={skill.id}
            label={skill.label}
            help={skill.id}
            checked={!disabled.has(skill.id)}
            disabled={!injectSkills}
            onChange={(enabled) => {
              const next = new Set(disabled);
              if (enabled) next.delete(skill.id);
              else next.add(skill.id);
              void onUpdate({ disabledBundledSkills: [...next] });
            }}
          />
        ))}
      </div>
    </Section>
  );
}
