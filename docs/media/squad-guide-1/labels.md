# Squad guide 1, What is a Squad?: label evidence

Static source check (main 3a5316f0), then confirmed in the built app by the passing recording spec `e2e/demo-squad-guide-1.spec.ts`, which locates each control by its accessible name.

| Label as scripted | Source file:line | Exact match? | Correction |
|---|---|---|---|
| Job details -> Assembled result | `apps/app/src/components/ExecutionJobDetails.tsx:274,352` (aria-label "Squad details"); `:493` (`<h4>Assembled result</h4>`); "Job details" appears only in code comments and toast "Job details copied" (`:327`) | NO for "Job details"; YES for "Assembled result" | Say and show "Squad details". Page `website/content/docs/squads-watch.md` also uses "Squad details". |
| Settings -> Agents & Automation -> Squads | `apps/app/src/views/settings/settings-navigation.ts:41` (group "Agents & Automation"), `:72` (item "Squads", group agents) | YES | None. Spoken as "Settings, under Agents and Automation, in Squads". |
| Builtin filter | `apps/app/src/views/settings/SquadsView.tsx:36` (`label: 'Builtin'`) | YES | None. |
| Five built-in Squads (Research, Design, Debug, Delivery, Review) | `apps/server/src/services/agents/team-store.ts:126,141,150,162,175` (names "Review Squad", "Research Squad", "Design Squad", "Debug Squad", "Delivery Squad") | YES (five, exact names) | None. |
| Research Squad: two low-cost workers | `team-store.ts:141-145` (description "Coordinator (medium) and two low-capacity investigators"; slot label "Investigator", quantity 2); page `squads-catalogue.md` "2 Investigators (Low)" | Partial | Say "two Low-tier investigators" (tier wording from `squads-start.md`), not "low-cost". |
| Persona = role, model level, instructions | `squads-start.md` "a role, a model tier (Low, Medium, or High), and instructions" | Wording differs from plan | Use "model tier", not "model level". |
| Orchestrator "plans and keeps it moving"; others are workers | `squads-start.md` Orchestrator definition ("plans and coordinates the work") | Paraphrase | Acceptable; no claim about what it cannot do. |
| Slot becomes a worker | `squads-start.md` ("each slot becomes a worker in the run") | YES (page) | None. |
| Inbox (asks you; open with Command I) | `apps/app/src/components/palette/buildItems.tsx:265` (hint ⌘I); `InboxOverview.tsx:79` "Needs your answer" | YES | Shortcut not spoken in V1. |
| "A person reviews the result." | `squads-start.md`, `squads-watch.md`, `squads-catalogue.md` ("A finished run does not prove your goal was met. A person reviews the result.") | YES | None. |

## Unfound / unverifiable
- Diagram overlay (Persona -> slot -> worker, Inbox at side) is a new graphic, not an app label.
- A "Research Squad" opened from the Builtin filter: open-in-detail view not statically inspected beyond the filter label.

## Overlap with existing "How to use a Squad" (`docs/media/squads/narration.json`)
Shots there: Squads concept intro (line 1), ask-an-agent, Settings -> Squads catalogue, New squad editor, slots, orchestrator, options, saved, launch, parallel, Flow, Inbox, finish. Overlap with V1: only the one-line intro "a team of agents plan, split, deliver" and the Settings -> Squads catalogue shot. Differentiators: Persona/Squad/Orchestrator vocabulary, the five named built-ins, Builtin filter, Squad-vs-single-agent rule, review reminder. No building steps, no launch.
