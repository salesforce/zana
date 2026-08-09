# Chat Rich Artifacts and Feedback Implementation

## Implemented

- Chat turns can carry validated, host-rendered `table`, `metric`, `timeline`,
  `fileComment`, and `artifactFile` values.
- The model emits these as JSON inside `zcc-artifact` fences. Main parses and
  bounds them before persistence; malformed or unsupported fences remain visible
  as ordinary text rather than being silently treated as UI.
- The renderer owns all markup. The artifact contract contains data only and has
  no action, callback, HTML, script, URL-fetch, or executable component shape.
- A negative reaction can include optional expected-behavior text. Reactions are
  capped as before, and explicit negative expectations are also projected into a
  local, atomic `feedback-cases.json` sidecar capped at 200 cases per session.

## Parallel Evidence

Partial, main-observed parallel-run evidence is persisted. Team launch results
provide the observed child roster/cohort references, and later child completion
events can add status and output. The UI deliberately labels this "Parallel run
evidence," not synthesis: it does not prove that the parent reconciled every
child or authored an authoritative combined conclusion. Parent text and tool
output are displayed as separate observed facts. Full synthesis remains limited
until the team runner emits a main-owned completion envelope linking stable child
result references, statuses, and an explicit parent synthesis id.

Other rich elements remain rejected until they have a real data seam. In
particular, executable controls, charts with inferred series, live resource
widgets, and file artifacts without observed content are not part of the typed
union and therefore remain ordinary transcript text.
