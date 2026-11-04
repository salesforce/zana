import type { Locator, Page } from '@playwright/test';

/** The full launcher remains reachable through the dock's quick-add menu. */
export async function openThreadToolLauncher(scope: Locator | Page) {
  const trigger = scope.getByTestId('thread-secondary-new-tab').first();
  const hasMenu = await trigger.getAttribute('aria-haspopup') === 'menu';
  await trigger.click();
  if (hasMenu) await trigger.page().getByRole('menuitem', { name: 'More tools…' }).click();
}
