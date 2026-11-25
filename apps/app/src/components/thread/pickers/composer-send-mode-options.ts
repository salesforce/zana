import type { ComposerSendMode } from '../../../lib/thread-composer-preferences.js';

export const COMPOSER_SEND_MODE_OPTIONS: Array<{ value: ComposerSendMode; label: string; description: string }> = [
  { value: 'auto', label: 'Auto', description: 'Enter queues while running; Cmd/Ctrl+Enter steers' },
  { value: 'steer', label: 'Steer', description: 'Enter steers a running turn; Cmd/Ctrl+Enter queues' },
  { value: 'queue-if-active', label: 'Queue', description: 'Hold the message until the current turn finishes' }
];
