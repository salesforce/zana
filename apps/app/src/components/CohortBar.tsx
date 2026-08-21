import { useMemo } from 'react';
import { Users, Moon, Crown } from 'lucide-react';
import { isIdleAgent, type AgentCard } from './AgentBoard.js';

/**
 * A live Team cohort: one launch of a team (cohortId minted per launch), with
 * the cards of its still-running members. Built from the board's card list by
 * grouping on `session.cohort.cohortId`.
 */
export interface LiveCohort {
  cohortId: string;
  teamId: string;
  teamName: string;
  cards: AgentCard[];
  /** The orchestrator card, if its session is still live. */
  orchestrator?: AgentCard;
  liveCount: number;
  idleCount: number;
}

/**
 * Group the board's cards into live Team cohorts. A cohort appears only while at
 * least one of its members is still live (exited-only cohorts drop off — the
 * team run is over). Order is by first-seen card so the bar is stable across
 * status ticks. Pure derive; the caller memoizes.
 */
export function buildLiveCohorts(cards: AgentCard[]): LiveCohort[] {
  const byId = new Map<string, LiveCohort>();
  const order: string[] = [];
  for (const c of cards) {
    const co = c.session.cohort;
    if (!co) continue;
    let g = byId.get(co.cohortId);
    if (!g) {
      g = {
        cohortId: co.cohortId,
        teamId: co.teamId,
        teamName: co.teamName,
        cards: [],
        liveCount: 0,
        idleCount: 0
      };
      byId.set(co.cohortId, g);
      order.push(co.cohortId);
    }
    g.cards.push(c);
    if (co.role === 'orchestrator' && c.session.status !== 'exited') g.orchestrator = c;
    if (c.session.status !== 'exited') g.liveCount += 1;
    if (isIdleAgent(c)) g.idleCount += 1;
  }
  // Keep only cohorts with a live member — a fully-exited team run is history.
  return order.map((id) => byId.get(id)!).filter((g) => g.liveCount > 0);
}

interface CohortBarProps {
  cards: AgentCard[];
  /** Close this cohort's idle members (opens the shared close-idle dialog). */
  onCloseIdle: (cohort: LiveCohort) => void;
}

/**
 * A compact bar of the live Team cohorts on the board — one chip per launch,
 * showing the team name, live/idle counts, and a per-cohort "Close idle" action
 * that reuses the same summarize-then-close path as the board's global button
 * (scoped to this cohort's idle members). Renders nothing when no team is live,
 * so it never takes space on a board without cohorts.
 */
export function CohortBar({ cards, onCloseIdle }: CohortBarProps) {
  const cohorts = useMemo(() => buildLiveCohorts(cards), [cards]);
  if (cohorts.length === 0) return null;

  return (
    <div className="cohort-bar" aria-label="Live teams">
      <span className="cohort-bar-label">
        <Users size={12} aria-hidden="true" /> Teams
      </span>
      {cohorts.map((co) => {
        // The lead = the orchestrator card (host-stamped `role:'orchestrator'`
        // at launch). Its live title names who's driving; closing that session
        // tears the whole team down (main-side cascade), so we surface it as the
        // team's lead both visually (crown) and in the chip's title.
        const leadName = co.orchestrator?.session.title?.trim();
        const leadTitle = co.orchestrator
          ? `${co.teamName} — lead: ${leadName || 'orchestrator'} (close it to end the whole team)`
          : `${co.teamName} — no live lead (orchestrator has exited)`;
        return (
        <div key={co.cohortId} className="cohort-chip" title={leadTitle}>
          {co.orchestrator && (
            <span className="cohort-chip-orch" aria-label="Team lead">
              <Crown size={11} aria-hidden="true" />
            </span>
          )}
          <span className="cohort-chip-name">{co.teamName}</span>
          <span className="cohort-chip-count" title={`${co.liveCount} live`}>
            {co.liveCount}
          </span>
          {co.idleCount > 0 && (
            <button
              type="button"
              className="cohort-chip-close"
              onClick={() => onCloseIdle(co)}
              title={`Close ${co.idleCount} idle ${co.idleCount === 1 ? 'agent' : 'agents'} in ${co.teamName}`}
            >
              <Moon size={11} aria-hidden="true" />
              {co.idleCount}
            </button>
          )}
        </div>
        );
      })}
    </div>
  );
}
