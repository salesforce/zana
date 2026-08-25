import type { ComponentType } from 'react';
import { ClaudeIcon } from '../../icons/ClaudeIcon.js';
import { CursorIcon } from '../../icons/CursorIcon.js';
import { OpenAiIcon } from '../../icons/OpenAiIcon.js';
import { OpencodeIcon } from '../../icons/OpencodeIcon.js';
import { PiIcon } from '../../icons/PiIcon.js';

export type ProviderMark = ComponentType<{ className?: string; size?: number }>;

const PROVIDER_ICONS: Record<string, ProviderMark> = {
  'claude-code': ClaudeIcon,
  codex: OpenAiIcon,
  pi: PiIcon,
  'acp-cursor': CursorIcon,
  'acp-opencode': OpencodeIcon
};

export function providerIconForId(providerId: string): ProviderMark | null {
  return PROVIDER_ICONS[providerId] ?? null;
}
