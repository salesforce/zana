import type { MouseEvent } from 'react';

/** Safari does not focus buttons on tap. Transfer focus before its default blur
 * can collapse the mobile composer and move the control out from under a tap. */
export function focusComposerControl(event: MouseEvent<HTMLElement>) {
  if (!(event.target instanceof Element)) return;
  const button = event.target.closest('button');
  if (button && !button.disabled && event.currentTarget.contains(button)) {
    // Handle mousedown, including touch-generated mouse events: cancelling
    // pointerdown suppresses the subsequent click on mobile WebKit.
    event.preventDefault();
    // These actions are available in both layouts. Preserve the current layout
    // until the click lands, especially Stop on a narrow, wrapped toolbar.
    if (button.matches('.thread-command-send, .thread-command-stop, [data-preserve-composer-focus]')) {
      return;
    }
    button.focus({ preventScroll: true });
  }
}
