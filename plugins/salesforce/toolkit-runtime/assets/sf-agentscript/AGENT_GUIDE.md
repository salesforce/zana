# AgentScript

Use agentscript_authoring with verb and mode; pass agent_file explicitly. Create/format/mutate and report writes require effects authorization. Live preview, evaluation, publishing, and activation require explicit target_org. Pass agent_name and session_id for preview send/end. Publish inactive, run the exact-version release evaluation, then activate an explicit version. Untested activation is unavailable. State is stored under .sf-agentic-tools in the selected workspace/project. Settings use built-in defaults; tool inputs control preview/evaluation behavior.

Inspection context and review include a Voice Profile for voice agents; voice advisories are review findings with category voice. Starter eval specs add voice greeting and distress probes unless include_voice_tests is false. Evaluation batches use org auth first and retry an HTTP 401 once with Agentforce named-user auth; incomplete batches still block release evidence. The runtime smoke check correlates AgentWork to the selected VoiceCall or MessagingSession from the last day and filters VoiceCall by phone_number when supplied.

See tools describe for the exact schema and action availability.
