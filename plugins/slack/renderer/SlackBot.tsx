/**
 * Headless, always-mounted Slack background (see {@link AppModule.background}).
 *
 * The live bot's poll loop runs in the MAIN process, but two of its actions —
 * launching a session (`host.launchSession`) and typing into one
 * (`host.replyToSession`/`writeToSession`) — are renderer-only. Main therefore
 * QUEUES those as intents and a renderer drains them. Likewise, session
 * lifecycle events (`session:agentStatus`/`session:exit`) arrive in the
 * renderer and must be forwarded to main.
 *
 * Originally these lived in SlackPanel — but a panel unmounts the moment the
 * user navigates away from the Slack tab, which silently killed the bridges and
 * left the bot deaf (queued runs never launched, ✅ reactions never delivered).
 * They belong here: mounted once for the whole session, regardless of nav.
 *
 * Deliberately CONFIG-SYNC-FREE so there's no enable/disable state to keep in
 * step with the panel:
 *   - the drain timer pulls launch + reply intents unconditionally; main only
 *     ever queues them while the bot is running, so when it's off the queues
 *     are empty and the drain is a cheap no-op.
 *   - lifecycle events always route through `sessionEvent` first (main no-ops
 *     if the bot isn't running or the session isn't bot-launched); the generic
 *     channel notify falls back only when main didn't handle it, gated on the
 *     freshly-read `notifyOn` flags.
 * Renders null — it's pure side effects.
 */

import { useEffect, useRef } from 'react';
import type { ModuleHost } from '@zana-ai/zcc-extension-sdk/renderer';
import {
  type SlackConfig,
  type PendingLaunch,
  type PendingReply,
  DEFAULT_SLACK_CONFIG
} from '../shared/types.js';
import { formatExitNotification, formatBlockedNotification } from '../shared/notify-format.js';

/** Drain cadence for the launch + reply bridges. */
const DRAIN_MS = 2000;

/** A session's UI identity, captured from `session:updated` for the exit notice. */
interface SessionMeta {
  title: string;
  projectId: string;
}

export default function SlackBot({ host }: { host: ModuleHost }) {
  // The `session:exit`/`session:agentStatus` payloads carry only an id + code —
  // not the tab title or owning project. Track each live session's identity
  // from `session:updated` (which DOES carry title + projectId, and fires at
  // creation) so the channel notice can name the session as the UI does and
  // attribute it to its OWN project, not whatever's currently selected.
  const sessionMeta = useRef<Map<string, SessionMeta>>(new Map());

  // Launch + reply bridges: one timer, drains both queues. Unconditional —
  // empty + cheap when the bot is off (main returns []).
  useEffect(() => {
    let cancelled = false;
    let draining = false;

    const drainLaunches = async () => {
      const pending = await host.call<PendingLaunch[]>('drainPendingLaunches').catch(() => []);
      for (const launch of pending) {
        if (cancelled) return;
        const projectId = launch.projectId ?? host.getActiveProject()?.id;
        let sessionId: string | null = null;
        if (projectId) {
          const res = await host
            .launchSession({
              projectId,
              extraArgs: [launch.prompt],
              title: `slack: ${launch.prompt.slice(0, 24)}`
            })
            .catch(() => null);
          sessionId = res?.id ?? null;
        }
        await host
          .call('recordLaunchedSession', launch.id, sessionId, launch.channel, launch.parentTs)
          .catch(() => undefined);
        if (sessionId) host.toast(`Slack launched a session: ${launch.prompt.slice(0, 40)}`);
      }
    };

    const drainReplies = async () => {
      const pending = await host.call<PendingReply[]>('drainPendingReplies').catch(() => []);
      for (const reply of pending) {
        if (cancelled) return;
        // `raw` replies (e.g. cancel's Esc) must NOT get a trailing Enter, so
        // they go through writeToSession; everything else submits a line.
        const ok = reply.raw
          ? await host.writeToSession(reply.sessionId, reply.text).catch(() => false)
          : await host.replyToSession(reply.sessionId, reply.text).catch(() => false);
        await host.call('recordReplied', reply, ok).catch(() => undefined);
      }
    };

    const tick = async () => {
      if (draining) return; // a slow launch/reply must not overlap the next tick
      draining = true;
      try {
        await drainLaunches();
        await drainReplies();
      } finally {
        draining = false;
      }
    };

    const timer = setInterval(() => void tick(), DRAIN_MS);
    void tick();
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [host]);

  // Lifecycle → Slack. Route every blocked/exit through the bot first (main
  // posts in-thread + returns handled:true for a bot-launched session); fall
  // back to the generic channel notify only when the bot didn't handle it AND
  // the matching notifyOn toggle is set. notifyOn is read fresh per-event so
  // there's no config state to sync.
  useEffect(() => {
    const handledByBot = async (
      event: 'blocked' | 'exit' | 'idle',
      sessionId: string,
      detail?: { code?: number }
    ): Promise<boolean> => {
      try {
        const res = await host.call<{ handled: boolean }>('sessionEvent', event, sessionId, detail);
        return res.handled;
      } catch {
        return false;
      }
    };

    const notifyOn = async (): Promise<SlackConfig['notifyOn']> => {
      const cfg = (await host.storage.get<SlackConfig>('config')) ?? DEFAULT_SLACK_CONFIG;
      return cfg.notifyOn;
    };

    // Resolve a session's display name + owning project name from the tracked
    // metadata. Falls back to the truncated id only when we never saw an update
    // for the session (e.g. it existed before the bot mounted).
    const describe = (sessionId: string): { name: string; projectName?: string } => {
      const meta = sessionMeta.current.get(sessionId);
      if (!meta) return { name: `session ${sessionId.slice(0, 8)}` };
      const project = host.listProjects().find((p) => p.id === meta.projectId);
      return { name: meta.title, projectName: project?.name };
    };

    // Keep the id → identity map current. Drop nothing here — exit prunes it.
    const offUpdated = host.on('session:updated', ({ session }) => {
      sessionMeta.current.set(session.id, {
        title: session.title,
        projectId: session.projectId
      });
    });

    const offStatus = host.on('session:agentStatus', ({ sessionId, state }) => {
      if (state === 'blocked') {
        void handledByBot('blocked', sessionId).then(async (handled) => {
          if (handled || !(await notifyOn()).sessionBlocked) return;
          const text = formatBlockedNotification(describe(sessionId));
          host.call('notify', text).catch((err) => console.error('Slack notify failed:', err));
        });
        return;
      }
      if (state === 'idle') {
        // Bot-launched sessions relay an in-thread answer summary on each idle
        // edge (main no-ops for non-bot sessions). No generic-channel notify
        // fallback for idle — the relay is in-thread only.
        void handledByBot('idle', sessionId);
      }
    });

    const offExit = host.on('session:exit', ({ sessionId, code }) => {
      void handledByBot('exit', sessionId, { code }).then(async (handled) => {
        // Read identity BEFORE pruning, so the notice still names the session.
        const { name, projectName } = describe(sessionId);
        sessionMeta.current.delete(sessionId);
        if (handled || !(await notifyOn()).sessionExit) return;
        const text = formatExitNotification({ name, code, projectName });
        host.call('notify', text).catch((err) => console.error('Slack notify failed:', err));
      });
    });

    return () => {
      offUpdated();
      offStatus();
      offExit();
    };
  }, [host]);

  return null;
}
