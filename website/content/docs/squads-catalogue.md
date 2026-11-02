# Choose a Squad

Zana ships five built-in Squads. Each one is a ready-made group of workers with a coordinator, called the **Orchestrator**. You do not have to build anything. Pick one, describe the work, and launch it.

This page helps you choose. For your first run, see [Start using Squads](/docs/squads-start/). For the launch steps, see [Launch a Squad](/docs/squads-launch/).

---

## Which Squad?

| If you want to... | Use | Workers (tier) | Relative cost (Lowest, Middle, High; not the same as worker tiers) |
|---|---|---|---|
| Compare options, survey an area of code, or summarize several documents and get a sourced report | **Research Squad** | 2 Investigators (Low) | Lowest |
| Write a technical design and have a second worker push back on it | **Design Squad** | Designer (High), Challenger (High) | High (two High-tier workers) |
| Find the cause of a failure: collect evidence first, then reason about the root cause | **Debug Squad** | Evidence collector (Low), Root-cause investigator (High) | Middle |
| Make a bounded change in two parts, then have it reviewed | **Delivery Squad** | 2 Engineers (Medium), Reviewer (High) | Middle to high |
| Get a focused code review of a diff or branch | **Review Squad** | Software Engineer (Medium), Code Reviewer (High) | Middle |

Every Squad also runs one Orchestrator at the Medium tier. Cost grows with the number of High-tier workers. A Squad that does not fit your job will cost money and give you a weak result. When in doubt, start with the Research Squad.

A Squad is not always the right tool. Use a single agent for small, serial, or exploratory tasks where you want to steer turn by turn. Use a Squad when the work splits into pieces that can run side by side, when a second pass adds value, or when you want a watchable record of steps and results.

A finished run does not prove your goal was met. A person reviews the result.

---

## Before you pick

These points apply to every Squad on this page.

- **You need a Project and one signed-in harness.** Claude is the recommended harness.
- **Each worker has a tier: Low, Medium, or High.** Low is the cheapest and fastest. High is for the hardest reasoning. The Orchestrator is Medium in every Squad.
- **The harness must have a model for every tier the Squad uses.** If it does not, the launch is refused. See [Harness support](#harness-support).
- **No built-in Squad restricts what its workers can do.** Role and scope come from the task text, so say plainly in your goal what the workers may and may not change.
- **Goals have a limit.** The goal is capped at 2,048 characters. A counter appears near the limit. If the goal is too long, Zana shows: "The goal is too long for a Squad (N of 2,048 characters). Move details into an attached plan or source."
- **Read results in Squad details.** The final output appears under **Assembled result**. Usage appears in the same place with the label "provider-reported cost".
- **Built-in Squads are fixed.** You can open them in **Settings → Agents & Automation → Squads** (use the **Builtin** filter). To change one, use **Edit override** in its detail view, or **Duplicate** in the row menu. See [Customize a Squad](/docs/squads-customize/).
- **The picker lists Squads alphabetically.**

### Harness support

Each Squad needs these tiers from your harness:

| Squad | Tiers needed |
|---|---|
| Research Squad | Low, Medium |
| Design Squad | Medium, High |
| Debug Squad | Low, Medium, High |
| Delivery Squad | Medium, High |
| Review Squad | Medium, High |

What Zana maps each tier to depends on the harness:

| Harness | Low | Medium | High |
|---|---|---|---|
| Claude | haiku | sonnet | opus |
| Codex | gpt-4o-mini | gpt-4o | gpt-4o |

Codex medium and high use the same model, so a High-tier worker on Codex uses the same model as a Medium one. Codex can also report its own model list, and Zana then uses that list. Treat the table as the built-in default.

Some harnesses have no tier-to-model mapping, so they cannot run these Squads. **pi, grok, and mastracode** have an empty mapping. A launch on one of them is refused. The composer shows "Squad launch failed: Team route facts could not be evaluated" (code `ADMISSION_FAILED`). That message does not name the harness or the tier, and it can have other causes. Zana writes the model-level cause, "<Harness> does not support <level> model level.", to its error log. If you hit this, switch the Project to Claude.

afcode picks its own models and has an empty mapping too. This guide makes no claim about launching Squads on afcode.

This guide does not claim that every harness Zana lists works with Squads. Claude is the harness this guide is written for.

---

## Research Squad

**Purpose.** Bounded research for code, requirements, and prior art. Workers gather evidence, options, and open questions before anyone proposes a change.

**Workers and tiers.** Orchestrator (Medium) and two Investigators (Low). Each Investigator uses the Squad Worker (Low) Persona, described as a "Low-capacity squad worker for bounded, mechanical, read-heavy work".

**When to use.**
- Compare options or libraries.
- Survey one area of a codebase.
- Summarize several documents in parallel.
- Produce a sourced report.

This is the cheapest Squad and the one used for your first run.

**Poor fits.** Anything that must change files. Work that needs deep reasoning from every worker.

**Prerequisites and supported harnesses.** A Project and a harness with Low and Medium models. Claude is the recommended harness. Routing is left on the default.

**Sample goal.**

```text
Compare two ways to add caching to this Project's API layer. Investigate each option separately, cite the files or sources for every finding, and combine both into one report with sections Summary, Findings (with sources), and Open questions. Do not edit project files.
```

This sample is plain text, not a plan. Use it with **Infer plan from goal**.

For a complete ready-to-paste plan, see [Start using Squads](/docs/squads-start/).

**Where output appears.** Open the run in Squad details. The report is in **Assembled result**. Usage is under **Usage**.

**Limits and safety.** There is no reviewer in this Squad, so a person must check the report and its sources. Workers can do what the task text allows. Tell them not to edit files.

**Model tiers and cost.** Two Low workers plus a Medium Orchestrator. On Claude that is haiku, haiku, and sonnet. Squad details shows the amount as "provider-reported cost".

**Availability.** Built in. No install needed.

---

## Design Squad

**Purpose.** Technical design work. One worker designs and another challenges the design. The result is a minimal plan with decisions, boundaries, and verification criteria.

**Workers and tiers.** Orchestrator (Medium), a Designer (High), and a Challenger (High). Both use the Squad Worker (High) Persona, described as a "High-capacity squad worker for hardest reasoning and final verification".

**When to use.**
- A technical design where a second pass should push back on the first.
- A trade-off write-up.

**Poor fits.** Quick questions. Cost-sensitive work. Two High-tier workers make this the most expensive Squad here.

**Prerequisites and supported harnesses.** A Project and a harness with Medium and High models. Claude is the recommended harness. Routing is left on the default.

**Sample goal.**

```text
Design how this Project should add per-user rate limiting to its public API. The Designer proposes the design with decisions and boundaries. The Challenger finds weaknesses and missing cases. Return one design with decisions, boundaries, open questions, and verification criteria. Do not edit project files.
```

This sample is plain text, not a plan. Use it with **Infer plan from goal**.

**Where output appears.** Squad details, under **Assembled result**.

**Limits and safety.** The Challenger is a second worker, it does not prove the design is sound. A person decides whether to accept it.

**Model tiers and cost.** Two High workers plus a Medium Orchestrator. On Claude that is opus, opus, and sonnet. On Codex both High workers use gpt-4o. Squad details shows "provider-reported cost".

**Availability.** Built in. No install needed.

---

## Debug Squad

**Purpose.** Find the cause of a failure. A cheap worker gathers evidence, then a stronger worker reasons about the root cause.

**Workers and tiers.** Orchestrator (Medium), an Evidence collector (Low), and a Root-cause investigator (High).

**When to use.** A failure with an unclear cause. You want logs and evidence collected first, then analysis.

**Poor fits.** Open-ended work that does not split into evidence and then analysis.

**Prerequisites and supported harnesses.** A Project and a harness with Low, Medium, and High models. This is the only Squad that needs all three tiers. Claude is the recommended harness. Routing is on for this Squad.

**Sample goal.**

```text
Our nightly export job fails about one run in five with a timeout. Collect the relevant logs, recent changes, and error messages. Then find the most likely root cause and list how to confirm it. Do not edit project files.
```

This sample is plain text, not a plan. Use it with **Infer plan from goal**.

**Where output appears.** Squad details, under **Assembled result**.

**Limits and safety.** With routing on, each piece of work must match a worker's role and tier. If no worker can take a piece, that piece fails with `NO_QUALIFIED_ROUTE`. The code appears in the text from **Copy details** in Squad details. Split the goal so each piece clearly fits either evidence gathering or root-cause analysis. The root cause is a finding to check, not a confirmed fix.

**Model tiers and cost.** One Low worker, one High worker, and a Medium Orchestrator. On Claude that is haiku, opus, and sonnet. Squad details shows "provider-reported cost".

**Availability.** Built in. No install needed.

---

## Delivery Squad

**Purpose.** Deliver a bounded change. Two Engineers each take a part, then a Reviewer checks the result.

**Workers and tiers.** Orchestrator (Medium), two Engineers (Medium), and a Reviewer (High).

**When to use.** A bounded change that splits into two parts, followed by a review pass.

**Poor fits.** Large or vague scope. Work that needs a formal sign-off. The Reviewer is another worker, not a sign-off.

**Prerequisites and supported harnesses.** A Project and a harness with Medium and High models. Claude is the recommended harness. Routing is on for this Squad.

**Sample goal.**

```text
Add a "last updated" timestamp to the Project settings page. Part 1: add the field to the data layer and its tests. Part 2: show it in the settings page and update the page tests. Then review both parts and report any problems found.
```

This sample is plain text, not a plan. Use it with **Infer plan from goal**.

**Where output appears.** Squad details, under **Assembled result**. Engineers change files in your Project, so check the changes in your Project too.

**Limits and safety.** This Squad changes files. Review the changes before you keep them. With routing on, a piece of work that no worker can take fails with `NO_QUALIFIED_ROUTE`. The code appears in the text from **Copy details** in Squad details. Keep the two parts clearly separate and small.

**Model tiers and cost.** Two Medium workers, one High worker, and a Medium Orchestrator. On Claude that is sonnet, sonnet, opus, and sonnet. On Codex Medium and High both use gpt-4o. Squad details shows "provider-reported cost".

**Availability.** Built in. No install needed.

---

## Review Squad

**Purpose.** On-demand help with a focused code review, for when an implementation needs a review pass.

**Workers and tiers.** An Orchestrator slot (Medium), a Software Engineer (Medium), and a Code Reviewer (High). The Code Reviewer is described as a "Senior code reviewer focused on correctness, edge cases, and clarity". The Software Engineer is a generalist who can act on findings.

**When to use.** Review a diff or branch on demand, with an engineer able to act on the findings.

**Poor fits.** A review that must not change anything. The Software Engineer can edit files if the task text lets it.

**Prerequisites and supported harnesses.** A Project and a harness with Medium and High models. Claude is the recommended harness. Routing is left on the default.

**Sample goal.**

```text
Review the changes on the current branch against main. Report only actionable findings: bugs, missing edge cases, and unclear code, each with a file and line. Do not change any files.
```

This sample is plain text, not a plan. Use it with **Infer plan from goal**.

**Where output appears.** Squad details, under **Assembled result**.

**Limits and safety.** Role and scope come from the task text, so say whether the engineer may change files. A review pass can miss problems. A person decides what to act on.

**Model tiers and cost.** One Medium worker, one High worker, and a Medium Orchestrator. On Claude that is sonnet, opus, and sonnet. Squad details shows "provider-reported cost".

**Availability.** Built in. No install needed.

---

## Next steps

- [Start using Squads](/docs/squads-start/): your first Research Squad run.
- [Launch a Squad](/docs/squads-launch/): all the ways to start a run.
- [Watch a Squad](/docs/squads-watch/): follow progress and recover a run.
- [Customize a Squad](/docs/squads-customize/): change a Squad or build your own.
