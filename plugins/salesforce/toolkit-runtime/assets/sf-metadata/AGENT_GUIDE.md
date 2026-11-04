# Metadata

Use deploy.preview and manifest locally. Specify target_org for remote actions. inventory requires types; source selection uses source_paths with optional manifest, or explicit metadata for retrieval/manifest generation. deploy.validate and deploy.start submit jobs and require effects authorization. retrieve submits a job for a dedicated output_dir; use retrieve.status to check progress and retrieve.result with the initiating run file to download it. Existing output files require overwrite=true.

See tools describe for the exact schema and action availability.
