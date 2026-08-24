import type { AppConfig } from '@shared/types';
import { Section, Field, CheckboxField } from './FormFields';
import { PopoverPicklist } from '../ui/PopoverPicklist';

/**
 * Experimental settings — opt-in features still under evaluation. Each is OFF by
 * default and lives here (not Global) so it's clear they're not yet first-class.
 * Add a feature's master toggle AND its dependent settings to this tab so the
 * whole experiment is configured in one place.
 */
export function ExperimentalTab({
  config,
  onConfigDraft,
  onUpdate
}: {
  config: AppConfig;
  onConfigDraft: (config: AppConfig) => void;
  onUpdate: (patch: Partial<AppConfig>) => void;
}) {
  return (
    <>
      <Section
        title="Experimental features"
        help="Opt-in features under active evaluation. They’re off by default and may change or be removed. Enabling one reveals its own settings here."
      >
        <CheckboxField
          label="Goals"
          help="Show the Goals tab in a project — persistent objectives with falsifiable success criteria that spawn worker sessions and self-evaluate until met. An experiment under active evaluation. Off ⇒ the Goals project tab is removed."
          checked={config.goalsEnabled ?? false}
          onChange={(v) => onUpdate({ goalsEnabled: v })}
        />
        <CheckboxField
          label="Catch-up summary"
          help="Experimental — when an agent sits idle or is waiting on a choice, precompute a quick catch-up summary under the terminal through monitor HTTP provider selected in Agents settings. Without one, summaries report unavailable. Also shows manual 'Summarize to inbox' button in agent modal. Off ⇒ both are hidden."
          checked={config.catchUpSummaryEnabled ?? false}
          onChange={(v) => onUpdate({ catchUpSummaryEnabled: v })}
        />
        <CheckboxField
          label="Feed-noise classifier"
          help="Experimental — a fast-model micro-call that DEMOTES routine 'task done' reports (comment-only, no docs/question/goal) into a folded 'Routine' section of the inbox feed, so high-value reports stay inline. Advisory only: it never hides a report with docs, an idea, a question, or a goal outcome, and a missing verdict just leaves everything inline. Off by default — each inbox change may trigger a background call on your own key."
          checked={config.feedNoiseClassifierEnabled ?? false}
          onChange={(v) => onUpdate({ feedNoiseClassifierEnabled: v })}
        />
      </Section>

      <Section
        anchorId="extension-llm"
        title="Extension LLM calls"
        help="Master switch for the brokered ctx.llm capability extensions can request. Off by default — a net-new egress + cost surface. When off, every ctx.llm call from any extension resolves to a degraded failure regardless of that extension's own permission grant."
      >
        <CheckboxField
          label="Allow extensions to make LLM calls"
          help="When enabled, extensions granted the llm permission can invoke ctx.llm. When disabled, all such calls fail closed, even for extensions with the permission granted."
          checked={config.extensionLlmEnabled ?? false}
          onChange={(v) => onUpdate({ extensionLlmEnabled: v })}
        />
      </Section>

      <Section
        anchorId="harness-microvm"
        title="microVM isolation (experimental)"
        help="Offer the microVM execution environment in the New Agent modal — an agent runs inside a hardware-isolated microVM (microsandbox / libkrun) instead of under the OS kernel sandbox. Off by default while the runtime bakes. Requires Apple Silicon / KVM / WHP; on unsupported hardware the launcher shows it disabled. When a launch requests it but the runtime is unavailable, it fails closed with a visible notice — never a silent downgrade."
      >
        <CheckboxField
          label="Offer the microVM environment"
          help="When enabled, the New Agent modal's isolation picker gains a ‘microVM’ option alongside Off."
          checked={config.microVmEnabled ?? false}
          onChange={(v) => onUpdate({ microVmEnabled: v })}
        />
      </Section>

      <Section
        anchorId="voice-input"
        title="Voice input (dictation)"
        help="Push-to-talk dictation powered by OpenAI's transcription API. Off by default — each recording is sent to OpenAI, billed per audio-minute on your own API key."
      >
        <CheckboxField
          label="Enable voice input (dictation)"
          help="Shows the mic button in the prompt composer so you can dictate instead of type."
          checked={config.voiceInputEnabled ?? false}
          onChange={(v) => onUpdate({ voiceInputEnabled: v })}
        />
        {config.voiceInputEnabled && (
          <>
            <p className="settings-note">
              Voice uses the <strong>OpenAI</strong> key you configure under{' '}
              <strong>Settings → LLM Providers</strong> — set an OpenAI key there to enable
              dictation. No separate voice key is needed.
            </p>
            <Field label="Transcription model">
              <PopoverPicklist
                value={config.voiceModel ?? 'whisper-1'}
                ariaLabel="Transcription model"
                searchable={false}
                onChange={(voiceModel) => onUpdate({ voiceModel })}
                options={[
                  { value: 'whisper-1', label: 'whisper-1' },
                  { value: 'gpt-4o-transcribe', label: 'gpt-4o-transcribe' },
                  { value: 'gpt-4o-mini-transcribe', label: 'gpt-4o-mini-transcribe' }
                ]}
              />
            </Field>
            <Field label="Language" help="ISO-639-1 code (e.g. 'en', 'fr'). Leave empty for auto-detect.">
              <input
                type="text"
                placeholder="auto-detect"
                value={config.voiceLanguage ?? ''}
                onChange={(e) => onConfigDraft({ ...config, voiceLanguage: e.target.value })}
                onBlur={(e) => onUpdate({ voiceLanguage: e.target.value.trim() })}
              />
            </Field>
          </>
        )}
      </Section>

      <Section
        anchorId="menubar-popover"
        title="Menu-bar popover (macOS)"
        help="Replace the plain menu-bar dropdown with a clean popover card: a glanceable, cross-project view of every agent — who needs you, who's working, today's spend — with footer nav. macOS only; takes effect on the next menu-bar click. On by default; off falls straight back to the native menu."
      >
        <CheckboxField
          label="Use the menu-bar popover"
          help="When enabled, clicking the menu-bar icon opens the popover card instead of the native dropdown menu."
          checked={config.menubarPopoverEnabled ?? true}
          onChange={(v) => onUpdate({ menubarPopoverEnabled: v })}
        />
      </Section>
    </>
  );
}
