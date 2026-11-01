/**
 * #532: Back from a project to the global view stalled for seconds and blinked
 * the project's thread. The route render ran as a React transition, and every
 * store update restarted it; `SplitThreadArea` switching the split scope during
 * render made the two trees flip that scope back and forth. It only landed when
 * React forced the transition after 5 s.
 *
 * It needs a loaded renderer to show, so this throttles the CPU through CDP and
 * keeps one thread in the project emitting output, as a working agent does.
 * Before the fix each Back took about 5.3 s here and the project thread was
 * missing for most of it.
 */
import { test, expect, dismissConsentOverlays } from './fixtures/app.js';
import type { CDPSession, Locator, Page } from '@playwright/test';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test.use({
  e2e: true,
  // The default session cap follows the runner's RAM; CI allows fewer than the 12 threads here.
  initialConfig: { tmuxScope: 'off', maxLiveSessions: 20 },
  launchEnv: process.platform === 'linux' ? { ZCC_E2E_VISIBLE: '1' } : {}
});
test.setTimeout(180_000);

// One stub for every claude thread: some scrollback, then either idle, or (in a
// project with `.live`) a braille spinner title and status line every 100 ms.
const STUB = `#!/bin/sh
i=0
while [ $i -lt 300 ]; do i=$((i+1)); echo "scrollback line $i"; done
if [ -f .live ]; then
  n=0
  while :; do
    n=$((n+1))
    for g in '\\342\\240\\213' '\\342\\240\\231' '\\342\\240\\271' '\\342\\240\\270'; do
      printf "\\033]2;$g Working\\007"
      printf "\\r\\033[K$g Working (%d)" $n
      sleep 0.1
    done
  done
fi
printf '\\033]2;\\342\\234\\263 Claude Code\\007'
cat
`;

const CPU_THROTTLE = 6;
const EXTRA_PROJECTS = 16;
const BACK_BUDGET_MS = 3_000;
// Room for one reparenting frame; before the fix the thread was gone for ~5 s.
const MISSING_TOLERANCE_MS = 150;

type BackSample = { switchedMs: number | null; projectThreadMissingMs: number };
type BusyWorkspace = { globalThread: string; busyProject: string; busyThread: string };
type BackProbe = {
  clickedAt: number;
  switchedAt: number;
  missingSince: number;
  missingMs: number;
  observer: MutationObserver | null;
};

/** Projects and stub `claude` threads: one global thread, one busy project thread, a realistic sidebar. */
async function createBusyWorkspace(page: Page, root: string): Promise<BusyWorkspace> {
  const stub = join(root, 'claude-stub.sh');
  writeFileSync(stub, STUB);
  chmodSync(stub, 0o755);
  await page.evaluate(async (bin) => { await window.cc.config.set({ claudeBinary: bin }); }, stub);
  const addProject = async (name: string, live = false) => {
    const dir = join(root, name);
    mkdirSync(dir);
    if (live) writeFileSync(join(dir, '.live'), '');
    return page.evaluate(async (path) => {
      const res = await window.cc.projects.add(path);
      if (!res.ok) throw new Error(res.message);
      return res.value.id;
    }, dir);
  };
  const addThread = (projectId: string, title: string) =>
    page.evaluate(async ({ projectId, title }) => {
      const res = await window.cc.terminals.create({ projectId, profile: 'claude', cols: 120, rows: 40, title });
      if (!res.ok) throw new Error(res.message);
      return res.value.id;
    }, { projectId, title });

  const globalThread = await addThread(await addProject('global-project'), 'Global thread');
  const busyProject = await addProject('busy-project', true);
  const busyThread = await addThread(busyProject, 'Busy thread');
  for (let i = 0; i < EXTRA_PROJECTS; i++) {
    const projectId = await addProject(`project-${i}`);
    if (i < 10) await addThread(projectId, `Thread ${i}`);
  }
  return { globalThread, busyProject, busyThread };
}

/** Back returns to the last global route, so open a global thread, then the busy project's thread. */
async function openBusyProjectThread(page: Page, back: Locator, workspace: BusyWorkspace): Promise<void> {
  const go = (path: string) => page.evaluate((to) => {
    history.pushState({}, '', to);
    dispatchEvent(new PopStateEvent('popstate'));
  }, path);
  const visibleTerminal = page.locator('.term .xterm:visible').first();
  await go(`/sessions/${encodeURIComponent(workspace.globalThread)}`);
  await expect(visibleTerminal).toBeVisible({ timeout: 20_000 });
  await go(`/projects/${encodeURIComponent(workspace.busyProject)}/sessions/${encodeURIComponent(workspace.busyThread)}`);
  await expect(back).toBeVisible({ timeout: 20_000 });
  await expect(visibleTerminal).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1_500);
}

/**
 * Times the next Back click until the project rail is gone, and how long the
 * busy thread's terminal is off screen before that. Watches the DOM, not
 * frames: a hidden CI window may never paint.
 */
async function installBackProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const probe: BackProbe = { clickedAt: 0, switchedAt: 0, missingSince: 0, missingMs: 0, observer: null };
    (window as unknown as { __backProbe: BackProbe }).__backProbe = probe;
    // The busy thread is the only terminal on screen now. Its element lives for
    // the whole session, so watch that element, not any terminal.
    const busyTerminal = [...document.querySelectorAll<HTMLElement>('.term')].find((el) => el.offsetParent !== null);
    if (!busyTerminal) throw new Error('busy thread terminal is not on screen');
    const shown = () => busyTerminal.isConnected && busyTerminal.offsetParent !== null;
    const sample = () => {
      if (!probe.clickedAt || probe.switchedAt) return;
      const now = performance.now();
      if (!document.querySelector('.settings-app-back')) {
        probe.switchedAt = now;
        if (probe.missingSince) probe.missingMs += now - probe.missingSince;
        probe.observer?.disconnect();
      } else if (!shown()) {
        probe.missingSince ||= now;
      } else if (probe.missingSince) {
        probe.missingMs += now - probe.missingSince;
        probe.missingSince = 0;
      }
    };
    document.addEventListener('click', (event) => {
      if ((event.target as Element | null)?.closest('.settings-app-back')) probe.clickedAt = performance.now();
    }, { capture: true, once: true });
    probe.observer = new MutationObserver(sample);
    probe.observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
  });
}

async function readBackProbe(page: Page): Promise<BackSample> {
  return page.evaluate(() => {
    const probe = (window as unknown as { __backProbe: BackProbe }).__backProbe;
    probe.observer?.disconnect();
    return {
      switchedMs: probe.switchedAt ? Math.round(probe.switchedAt - probe.clickedAt) : null,
      projectThreadMissingMs: Math.round(probe.missingMs)
    };
  });
}

/** Clicks Back with the renderer CPU throttled, as on a loaded machine. */
async function measureBack(page: Page, cdp: CDPSession, back: Locator): Promise<BackSample> {
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE });
  try {
    await page.waitForTimeout(500);
    await installBackProbe(page);
    await back.click();
    await expect(back).toBeHidden({ timeout: 30_000 });
  } finally {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  }
  return readBackProbe(page);
}

test('Back from a busy project lands on the global view without blinking the project thread', async ({ app }) => {
  const { window: page } = app;
  await dismissConsentOverlays(page);
  const root = mkdtempSync(join(tmpdir(), 'zcc-project-back-'));
  const cdp = await page.context().newCDPSession(page);
  const back = page.getByRole('button', { name: 'Back to all projects', exact: true });
  try {
    const workspace = await createBusyWorkspace(page, root);
    for (let attempt = 0; attempt < 2; attempt++) {
      await openBusyProjectThread(page, back, workspace);
      const sample = await measureBack(page, cdp, back);
      console.log(`[project-back] attempt ${attempt}: switched after ${sample.switchedMs} ms, project thread missing ${sample.projectThreadMissingMs} ms`);
      expect(sample.switchedMs).not.toBeNull();
      expect(sample.switchedMs!).toBeLessThan(BACK_BUDGET_MS);
      expect(sample.projectThreadMissingMs).toBeLessThan(MISSING_TOLERANCE_MS);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
