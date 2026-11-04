# Remote Project Reference

Use `list_projects` to find a registered remote project id. `remote_read`,
`remote_glob`, and `remote_grep` use project-root-confined paths. `remote_exec`
runs a shell command on that registered remote project and may require approval.
Never provide a host, credential, or path outside project root.

```ts
remote_glob({ pattern, path })
remote_grep({ pattern, path })
remote_read({ path })
remote_exec({ projectId, command, cwd, timeoutMs })
```
