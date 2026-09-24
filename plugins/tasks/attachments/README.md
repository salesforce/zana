# Task attachment HTTP surface

Attachment upload uses a raw request body at
`POST /api/v1/plugins/tasks/http/attachments/upload`. The Tasks UI sends raw
bytes through Zana's same-origin product HTTP surface. Plugin HTTP routes
accept binary bodies while retaining the host's loopback and trusted-origin
checks. Request bodies are capped at 25 MiB; no separate plugin token is used.

Upload metadata may use query parameters (`taskId` or `commentId`, `fileName`,
and `mime`) or the corresponding `x-task-id`, `x-comment-id`, `x-file-name`,
and `x-mime-type` headers. Exactly one owner is required. The response is
`{ attachmentId, url }`.

The returned frontend URL is
`GET /api/v1/plugins/tasks/http/attachments/download?attachmentId=...`.
Deletion is
`DELETE /api/v1/plugins/tasks/http/attachments/delete?attachmentId=...`.
