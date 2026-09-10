import { expect, type Page } from '@playwright/test';

export interface JobBlockerView {
  id: string;
  question: string;
  options?: string[];
}

interface ExecutionView {
  state: string;
  currentBlocker?: JobBlockerView | null;
}

async function readExecution(window: Page, projectId: string, executionId: string): Promise<ExecutionView | null> {
  return window.evaluate(async ({ projectId, executionId }) => {
    const snapshot = await window.cc.executionBoard.snapshot(projectId, executionId, 0);
    if (!snapshot) return null;
    return {
      state: snapshot.execution.state,
      currentBlocker: snapshot.execution.currentBlocker
        ? {
            id: snapshot.execution.currentBlocker.id,
            question: snapshot.execution.currentBlocker.question,
            options: snapshot.execution.currentBlocker.options
          }
        : null
    };
  }, { projectId, executionId });
}

export async function answerJobBlockerThroughUi(args: {
  window: Page;
  projectId: string;
  executionId: string;
  jobTitle: string;
  answer?: string;
}): Promise<void> {
  const { window, projectId, executionId, jobTitle } = args;
  const answer = args.answer ?? 'About Atlas';

  await expect.poll(async () => {
    const execution = await readExecution(window, projectId, executionId);
    if (execution && ['FAILED', 'STOPPED'].includes(execution.state)) {
      throw new Error(`execution ${execution.state} before blocker appeared`);
    }
    return execution?.currentBlocker?.question ?? '';
  }, { timeout: 60_000, intervals: [1_000] }).toContain('label');

  // A CLI Agent owner launch opens the owner's foreground terminal modal
  // (launcher → navigate to the session route → AgentTerminalModal). It
  // legitimately lingers over the board until the exited owner's tombstone
  // clears (~60s), and its `.modal-backdrop` intercepts pointer events, so
  // dismiss it before driving the board. Escape is deliberately NOT a close
  // here (it reaches the embedded terminal as an interrupt) — use the X. The
  // UI / Modern owner paths never open this modal, so this is a no-op there.
  const ownerModal = window.getByRole('dialog', { name: /^Agent / }).first();
  if (await ownerModal.count()) {
    await ownerModal.getByRole('button', { name: 'Close' }).click();
    await expect(ownerModal).toBeHidden();
  }

  const agentsNav = window.getByTestId('nav-agents').or(window.getByTestId('project-nav-agents'));
  await agentsNav.click();
  const card = window.locator('.agent-card').filter({ hasText: jobTitle }).first();
  await expect(card).toBeVisible({ timeout: 15_000 });
  await card.click();

  const details = window.getByLabel('Team details');
  await expect(details).toBeVisible();
  await expect(details.getByText('Current blocker', { exact: true })).toBeVisible();
  await expect(details.getByText('Which label should result.txt use?', { exact: true })).toBeVisible();
  await expect(details.getByText('About · About Atlas', { exact: true })).toBeVisible();

  await window.getByTestId('nav-inbox').or(window.getByTestId('project-nav-inbox')).click();
  const pinned = window.locator('.inbox-questions-pinned');
  await expect(pinned.getByText('Needs your answer', { exact: true })).toBeVisible({ timeout: 15_000 });
  await pinned.getByText(jobTitle, { exact: true }).click();

  const question = window.locator('.inbox-question');
  await expect(question).toContainText('Which label should result.txt use?');
  await question.getByRole('radio', { name: new RegExp(answer, 'i') }).click();
  await question.getByRole('button', { name: /^(Continue|Reopen & answer)$/ }).click();

  await expect.poll(async () => (await readExecution(window, projectId, executionId))?.state ?? 'missing', {
    timeout: 60_000,
    intervals: [1_000]
  }).toBe('COMPLETED');

  await window.getByTestId('nav-agents').or(window.getByTestId('project-nav-agents')).click();
  await window.locator('.agent-card').filter({ hasText: jobTitle }).first().click();
  const completed = window.getByLabel('Team details');
  await expect(completed.getByText(/COMPLETED · attempt/)).toBeVisible({ timeout: 15_000 });
  await expect(completed.getByText('4/4 complete', { exact: false })).toBeVisible();
}
