# Growth Studio decisions

Settled decisions. Tasks append new rows when they must settle something the
plan leaves open; they never reopen an existing row.

| ID | Date | Decision | Rationale |
|---|---|---|---|
| D-001 | 2026-09-04 | The repository is the Growth Studio entry point; goals are the Missions panel of a repository workspace. Content items link to a repository and optionally to one or more goals. | A release thread serves stars, forks and downloads at once; a plan makes sense without a numeric target; the unified calendar needs repository-level ownership of content. |
| D-002 | 2026-09-04 | Growth Studio is a separate shell at `/growth`, opened from the main menu with `target="_blank"` and `rel="noopener"`. It has its own top bar and sidebar and renders no dashboard filters, tab strip or footer. | The user wants a focused tool that hides unrelated parts and can sit next to the dashboard in another window. |
| D-003 | 2026-09-04 | Publishing is copy-paste. Every post reaching `ready` must carry at least one media attachment; the UI offers copy text, copy image to clipboard and download image. The application never posts to a network. | No credentials to store, no platform approvals; media-complete posts are the value the user asked for. |
| D-004 | 2026-09-04 | A unified calendar across repositories is in scope, with a colour per repository and multi-repository deconfliction at plan time. | Maintainers of several projects plan as one person. |
| D-005 | 2026-09-04 | Generated image cards are SVG templates produced by the server and rasterized in the browser on a canvas. No native image dependency is added. | Keeps the Docker image and install small and avoids platform-specific builds. |
| D-006 | 2026-09-04 | The task loop mirrors the Emailchef `web-ui-ng-project` runner: `GS-NNN` tasks, `PROGRESS.md` ledger, gate, repair sessions, Telegram notifications. Default agent is pi. Commits carry no `Co-Authored-By` trailer. | Proven structure; pi is the preferred agent; user preference on trailers. |
| D-007 | 2026-09-04 | Interventions and content items become first-class SQLite rows; the legacy JSON in `repository_goals.suggestions` is migrated once and no longer written. | Statuses, dates and attribution need rows, not blobs. |
| D-008 | 2026-09-04 | Plan generation separates slots (deterministic, from cadence and pillars) from angles (AI, one call per plan) from drafts (AI, on demand or batch). | Cheap to regenerate, reorderable before writing, testable without AI. |
