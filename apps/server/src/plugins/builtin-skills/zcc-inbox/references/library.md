# Library and Goals Reference

Use library tools for durable project knowledge. Read existing documents before
updating them. Use goals only for falsifiable autonomous objectives. Tool schemas
define valid paths and success criteria.

```ts
library_list()
library_read({ relPath })
library_write({ relPath, title, content, summary, tags })
goal_create({ title, statement, successCriteria, activate })
goal_list()
```
