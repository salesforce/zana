/**
 * Notifications area (R-NOTIF-*).
 *
 *  • In-app notifications — the global master switch ({@link
 *    PrMonitorSettings.notifyInApp}). ANDed with each repo's per-repo flag and
 *    the per-PR mute (R-LIST-018).
 *  • Send to Inbox — additive over the shared mute scoping and independent of
 *    the in-app flag; requires a Project association per PR (AC-INBOX-2.3).
 *  • Sidebar badge — Total vs Unread ({@link PrMonitorSettings.badgeMode}),
 *    default Unread, with helper text naming what each counts.
 */

import type { PrMonitorSettings } from '../../../lib/types.js';
import { AreaHeader } from './ui.js';

export function NotificationsArea({
  settings,
  update,
}: {
  settings: PrMonitorSettings;
  update: (patch: Partial<PrMonitorSettings>) => void;
}) {
  // notifyInApp mirrors the legacy notifyOnChange for back-compat — write both.
  const inApp = settings.notifyInApp ?? settings.notifyOnChange;

  return (
    <div className="prm-area">
      <AreaHeader title="Notifications" subtitle="How to be notified when pull request status changes" />

      <label className="prm-checkbox-row">
        <input
          type="checkbox"
          checked={inApp}
          onChange={(e) => update({ notifyInApp: e.target.checked, notifyOnChange: e.target.checked })}
        />
        <span>
          <strong>In-app notifications</strong>
          <small>Show a notification when a monitored PR changes status. Master switch — a repo or PR can still mute below this.</small>
        </span>
      </label>

      <label className="prm-checkbox-row">
        <input
          type="checkbox"
          checked={settings.sendToInbox ?? false}
          onChange={(e) => update({ sendToInbox: e.target.checked })}
        />
        <span>
          <strong>Send to Inbox</strong>
          <small>Also push status changes to your project Inbox. Requires the PR to be associated with a Project.</small>
        </span>
      </label>

      <section className="prm-subsection">
        <h4 className="prm-subsection-title">Sidebar badge</h4>
        <label className="prm-radio-row">
          <input
            type="radio"
            name="prm-badge"
            checked={settings.badgeMode === 'unread'}
            onChange={() => update({ badgeMode: 'unread' })}
          />
          <span>
            <strong>Unread changes</strong>
            <small>Counts PRs with an unseen status change since you last viewed them.</small>
          </span>
        </label>
        <label className="prm-radio-row">
          <input
            type="radio"
            name="prm-badge"
            checked={settings.badgeMode === 'total'}
            onChange={() => update({ badgeMode: 'total' })}
          />
          <span>
            <strong>Total count</strong>
            <small>Counts every monitored PR, read or unread.</small>
          </span>
        </label>
      </section>
    </div>
  );
}
