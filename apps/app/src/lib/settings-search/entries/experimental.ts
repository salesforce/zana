import type { AppConfig } from '@zana-ai/zcc-domain/product';
import type { SettingsSearchEntry, SettingsValueSnapshot } from '../types';

const onOff = (read: (c: AppConfig) => boolean | undefined, fallback = false) =>
  (s: SettingsValueSnapshot) => ((read(s.config) ?? fallback) ? 'On' : 'Off');

const VOICE_MODELS = ['gpt-transcribe (Codex)', 'whisper-1', 'gpt-4o-transcribe', 'gpt-4o-mini-transcribe'] as const;

export const entries: readonly SettingsSearchEntry[] = [
  {
    id: 'experimental.provider-service-tiers',
    section: 'experimental',
    anchor: 'provider-service-tiers',
    label: 'Provider service tiers',
    help: 'Control whether providers offer non-default tiers.',
    keywords: ['fast mode', 'priority tier', 'flex'],
    kind: 'subsection'
  },
  {
    id: 'experimental.disable-service-tiers',
    section: 'experimental',
    anchor: 'provider-service-tiers',
    label: 'Disable non-default service tiers',
    help: 'Hide tier choices and reject non-default tier requests on this instance.',
    keywords: ['service tier', 'fast', 'priority', 'provider'],
    kind: 'setting',
    value: onOff((c) => c.providerServiceTiersDisabled)
  },
  {
    id: 'experimental.plugin-recovery',
    section: 'experimental',
    anchor: 'plugin-recovery',
    label: 'Plugin recovery',
    help: 'Temporarily suspend installed plugins while diagnosing a problem.',
    keywords: ['troubleshoot', 'diagnose'],
    kind: 'subsection'
  },
  {
    id: 'experimental.plugin-safe-mode',
    section: 'experimental',
    anchor: 'plugin-recovery',
    label: 'Plugin safe mode',
    help: 'Suspend non-bundled plugins and their tools. Turning this off restores plugins that were enabled. Your plugin settings are preserved.',
    keywords: ['disable plugins', 'suspend', 'crash', 'troubleshoot'],
    kind: 'setting',
    value: onOff((c) => c.pluginSafeMode)
  },
  {
    id: 'experimental.experimental-features',
    section: 'experimental',
    anchor: 'experimental-features',
    label: 'Experimental features',
    help: 'Features under active evaluation. Defaults vary by feature; you can switch any experiment off. They may change or be removed.',
    keywords: ['labs', 'beta', 'opt-in'],
    kind: 'subsection'
  },
  {
    id: 'experimental.dockable-thread-tools',
    section: 'experimental',
    anchor: 'experimental-features',
    label: 'Dockable thread tools',
    help: 'Enabled by default on desktop. Drag tool tabs between the right panel and a resizable bottom panel. Each thread remembers its arrangement. Moving a terminal keeps its session running. Turn off to show all tools in the right panel.',
    keywords: ['dock', 'terminal', 'bottom', 'side panel', 'drag', 'resize', 'tools'],
    kind: 'setting',
    value: onOff((c) => c.dockableThreadToolsEnabled, true)
  },
  {
    id: 'experimental.thread-tabs',
    section: 'experimental',
    anchor: 'experimental-features',
    label: 'Thread tabs',
    help: 'Enabled by default on desktop. Open threads in the main view and keep shortcuts across the title bar, with project names and live status. Closing a tab keeps the thread running. Turn off to restore inspector navigation (unless Classic session view is enabled).',
    keywords: ['navigation', 'title bar', 'open threads', 'switch threads', 'project tabs'],
    kind: 'setting',
    value: onOff((c) => c.threadTabsEnabled, true)
  },
  {
    id: 'experimental.goals',
    section: 'experimental',
    anchor: 'experimental-features',
    label: 'Goals',
    help: 'Show the Goals tab in a project — persistent objectives with falsifiable success criteria that spawn worker sessions and self-evaluate until met. An experiment under active evaluation. Off ⇒ the Goals project tab is removed.',
    keywords: ['objectives', 'success criteria', 'autopilot'],
    kind: 'setting',
    value: onOff((c) => c.goalsEnabled)
  },
  {
    id: 'experimental.catch-up-summary',
    section: 'experimental',
    anchor: 'experimental-features',
    label: 'Catch-up summary',
    help: "Experimental — when an agent sits idle or is waiting on a choice, precompute a quick catch-up summary under the terminal using the fastest model. Also shows the manual 'Summarize to inbox' button in the agent modal. Off ⇒ both are hidden.",
    keywords: ['recap', 'idle', 'summarise', 'summarize to inbox'],
    kind: 'setting',
    value: onOff((c) => c.catchUpSummaryEnabled)
  },
  {
    id: 'experimental.close-wrap-up',
    section: 'experimental',
    anchor: 'experimental-features',
    label: 'Wrap up before closing',
    help: 'Close with follow-up, and Close idle with follow-ups, first ask each agent to save what it learnt and tidy up. Each agent is then closed with the same summary as Summarize to inbox, and a follow-up if work is left. When off, they close straight away with a short note.',
    keywords: ['wrap up', 'self-learn', 'close with follow-up', 'summary'],
    kind: 'setting',
    value: onOff((c) => c.closeWrapUpEnabled)
  },
  {
    id: 'experimental.close-wrap-up-instructions',
    section: 'experimental',
    anchor: 'experimental-features',
    label: 'Instructions sent to the agent',
    help: 'Typed into the agent when you choose Close with follow-up.',
    keywords: ['wrap up', 'self-learn', 'close with follow-up', 'instructions'],
    kind: 'setting',
    dependsOn: 'experimental.close-wrap-up'
  },
  {
    id: 'experimental.classic-session-view',
    section: 'experimental',
    anchor: 'experimental-features',
    label: 'Classic session view',
    help: 'Skip the inspector overlay. Opening a CLI agent or thread — from the Agents canvas, favorites, a launch peek, or the menu bar — goes to the full session or thread page. Off by default. With Thread tabs enabled, threads already open in the main view; this option also applies to CLI agents.',
    keywords: ['inspector', 'peek', 'full page'],
    kind: 'setting',
    value: onOff((c) => c.classicSessionViewEnabled)
  },
  {
    id: 'experimental.feed-noise-classifier',
    section: 'experimental',
    anchor: 'experimental-features',
    label: 'Feed-noise classifier',
    help: "Experimental — a fast-model micro-call that DEMOTES routine 'task done' reports (comment-only, no docs/question/goal) into a folded 'Routine' section of the inbox feed, so high-value reports stay inline. Advisory only: it never hides a report with docs, an idea, a question, or a goal outcome, and a missing verdict just leaves everything inline. Off by default — each inbox change may trigger a background call on your own key.",
    keywords: ['inbox', 'routine', 'noise', 'reports'],
    kind: 'setting',
    value: onOff((c) => c.feedNoiseClassifierEnabled)
  },
  {
    id: 'experimental.in-app-terminals',
    section: 'experimental',
    anchor: 'experimental-features',
    label: 'Keep agent terminals in ZCC',
    help: 'When an agent would open Terminal.app, iTerm, or another standalone terminal, open a ZCC shell in this thread’s side panel instead. Off by default. Applies to new sessions only.',
    keywords: ['terminal.app', 'iterm', 'side panel', 'shell'],
    kind: 'setting',
    value: onOff((c) => c.inAppAgentTerminalsEnabled)
  },
  {
    id: 'experimental.extension-llm',
    section: 'experimental',
    anchor: 'extension-llm',
    label: 'Extension LLM calls',
    help: "Master switch for the brokered ctx.llm capability extensions can request. Off by default — a net-new egress + cost surface. When off, every ctx.llm call from any extension resolves to a degraded failure regardless of that extension's own permission grant.",
    keywords: ['plugins', 'extensions', 'ctx.llm', 'egress'],
    kind: 'subsection'
  },
  {
    id: 'experimental.allow-extension-llm',
    section: 'experimental',
    anchor: 'extension-llm',
    label: 'Allow extensions to make LLM calls',
    help: 'When enabled, extensions granted the llm permission can invoke ctx.llm. When disabled, all such calls fail closed, even for extensions with the permission granted.',
    keywords: ['plugins', 'extensions', 'ctx.llm', 'permission'],
    kind: 'setting',
    value: onOff((c) => c.extensionLlmEnabled)
  },
  {
    id: 'experimental.microvm-isolation',
    section: 'experimental',
    anchor: 'harness-microvm',
    label: 'microVM isolation (experimental)',
    help: 'Offer the microVM execution environment in the New Agent modal — an agent runs inside a hardware-isolated microVM (microsandbox / libkrun) instead of under the OS kernel sandbox. Off by default while the runtime bakes. Requires Apple Silicon / KVM / WHP; on unsupported hardware the launcher shows it disabled. When a launch requests it but the runtime is unavailable, it fails closed with a visible notice — never a silent downgrade.',
    keywords: ['sandbox', 'libkrun', 'microsandbox', 'vm', 'isolation'],
    kind: 'subsection'
  },
  {
    id: 'experimental.microvm',
    section: 'experimental',
    anchor: 'harness-microvm',
    label: 'Offer the microVM environment',
    help: "When enabled, the New Agent modal's isolation picker gains a ‘microVM’ option alongside Off.",
    keywords: ['sandbox', 'libkrun', 'vm', 'isolation'],
    kind: 'setting',
    value: onOff((c) => c.microVmEnabled)
  },
  {
    id: 'experimental.voice-input',
    section: 'experimental',
    anchor: 'voice-input',
    label: 'Voice input (dictation)',
    help: 'Push-to-talk dictation. Audio is transcribed through the Codex ChatGPT login on the connected computer (`codex login`). An OPENAI_API_KEY set on that computer is only an optional fallback.',
    keywords: ['microphone', 'speech', 'dictate', 'push-to-talk', 'transcription'],
    kind: 'subsection'
  },
  {
    id: 'experimental.voice-input-enabled',
    section: 'experimental',
    anchor: 'voice-input',
    label: 'Enable voice input (dictation)',
    help: 'Shows the mic button in every composer so you can dictate instead of type. It stays disabled, with the reason on hover, until the connected computer has a Codex login or OPENAI_API_KEY.',
    keywords: ['microphone', 'speech', 'mic', 'dictate'],
    kind: 'setting',
    value: onOff((c) => c.voiceInputEnabled)
  },
  {
    id: 'experimental.voice-model',
    section: 'experimental',
    anchor: 'voice-input',
    label: 'Fallback transcription model',
    options: VOICE_MODELS,
    keywords: ['whisper', 'speech to text'],
    kind: 'setting',
    dependsOn: 'experimental.voice-input-enabled',
    value: (s) => s.config.voiceModel ?? 'gpt-transcribe'
  },
  {
    id: 'experimental.voice-language',
    section: 'experimental',
    anchor: 'voice-input',
    label: 'Language',
    help: "ISO-639-1 code (e.g. 'en', 'fr'). Leave empty for auto-detect.",
    keywords: ['locale', 'dictation language'],
    kind: 'setting',
    dependsOn: 'experimental.voice-input-enabled',
    value: (s) => s.config.voiceLanguage || undefined
  },
  {
    id: 'experimental.menubar-popover-section',
    section: 'experimental',
    anchor: 'menubar-popover',
    label: 'Menu-bar popover (macOS)',
    help: "Replace the plain menu-bar dropdown with a clean popover card: a glanceable, cross-project view of every agent — who needs you, who's working, today's spend — with footer nav. macOS only; takes effect on the next menu-bar click. On by default; off falls straight back to the native menu.",
    keywords: ['menubar', 'tray', 'status bar'],
    kind: 'subsection'
  },
  {
    id: 'experimental.menubar-popover',
    section: 'experimental',
    anchor: 'menubar-popover',
    label: 'Use the menu-bar popover',
    help: 'When enabled, clicking the menu-bar icon opens the popover card instead of the native dropdown menu.',
    keywords: ['menubar', 'tray', 'dropdown'],
    kind: 'setting',
    value: onOff((c) => c.menubarPopoverEnabled, true)
  }
];

export default entries;
