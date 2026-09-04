# Growth Studio plan

Authoritative architecture and phase plan for the Growth Studio project.
Read it in full before every task. Sections marked *settled* are decisions
recorded in `GS_DECISIONS.md`; do not reopen them inside a task.

## 1. Goal

Turn Growth Studio from a panel inside the Goals tab into the central growth
tool of GitDeck:

1. A **dedicated shell** at `/growth`, opened from the main menu in a new
   window, that hides everything unrelated (dashboard filters sidebar, tab
   strip, footer) and has its own navigation.
2. A **repository-centric workspace**: the repository is the entry point;
   goals ("missions"), interventions, calendar, library and review are panels
   of that workspace.
3. **Interventions as an editorial plan**: interventions and content items are
   first-class persisted entities with status and dates; the AI fills a
   calendar built from content pillars and per-channel cadence, then drafts
   each slot with mandatory media.
4. A **measure-and-learn loop**: published content is attributed to metric
   deltas, a weekly Growth Review reports what worked, and the next plan is
   re-weighted accordingly.
5. A **unified calendar** across every repository with a growth profile.

## 2. Hard constraints

- Everything outside Growth Studio keeps its routes, layout and behavior. The
  only change to the main application chrome is replacing the `goals` tab with
  the Growth Studio link (`target="_blank"`, `rel="noopener"`).
- `AGENTS.md` rules: English everywhere; pure logic in `src/utils` with
  mirrored tests in `tests/utils`; server logic tests in `tests/server`; no
  tests under `src`; forge API access only through server endpoints; no
  unrelated refactors; TypeScript for new files.
- Both `src/i18n/en.ts` and `src/i18n/it.ts` receive every new key.
- Publishing is copy-paste only. No social credentials, no outbound posting.
- Media is mandatory: a content item cannot become `ready` without at least one
  media attachment.
- Schema changes are additive and idempotent (`CREATE TABLE IF NOT EXISTS`,
  `ALTER TABLE ... ADD COLUMN` guarded by a `PRAGMA table_info` check). Existing
  `repository_goals` and `repository_content_sources` rows keep working.
- New native dependencies are not allowed. Image rasterization happens in the
  browser (SVG drawn on a canvas), not on the server.
- Each task ends with `growth-studio-project/scripts/validate-gs-task.sh`
  printing `VALIDATION OK`, one conventional commit (scope `growth`), no push,
  no `Co-Authored-By` trailer.

## 3. Settled decisions (see GS_DECISIONS.md)

- D-001 Repository is the entry point; goals are a panel.
- D-002 Growth Studio opens in a separate window from the main menu.
- D-003 Copy-paste publishing with mandatory media; images are copied to the
  clipboard or downloaded, never posted by the app.
- D-004 Unified multi-repository calendar is in scope.
- D-005 Client-side rasterization for generated image cards.
- D-006 The loop runs with pi by default; Telegram notifications reuse the
  Emailchef runner variables.

## 4. Current state (inventory, 2026-09-04)

Files a task will most often touch or extend:

| Area | Files | Notes |
|---|---|---|
| Types | `src/types/goals.ts` | `RepositoryGoal`, `GoalSuggestion` (the current "intervention"), `GoalProposal` (the current draft), `GoalContentSource`, metric definitions |
| Server store | `src/server/goalStore.ts` | SQLite tables `repository_goals` (suggestions and proposals stored as JSON in `suggestions`) and `repository_content_sources` |
| Server logic | `src/server/goals.ts` | metric resolvers, `generateGoalSuggestions`, `generateGoalProposals`, README/release/website signal fetching with SSRF guards, `SOCIAL_PROPOSALS_VERSION` |
| Routes | `src/server/routes/goals.ts`, `src/server/routes/repository.ts` (content sources), `src/server/routes/index.ts` | `/api/goals*` |
| AI | `src/server/ai/client.ts` (`generateStructured`, `AiNotConfiguredError`, `AiRequestError`), `src/server/ai/settings.ts` (`isAiConfigured`), `src/server/aiDigest.ts` | provider-agnostic structured JSON generation |
| Data helpers | `src/server/dashboardData.ts` (cached repos, issues, PRs), `src/server/githubClient.ts` (`restApi`, `restApiPaginate`, `ghApiJson`), `src/server/snapshots.ts` (daily stars and forks history, 90 days), `src/server/digests.ts` | reuse for signals and attribution |
| Persistence helpers | `src/server/sqlite.ts` (`getDatabase`, `run`, `get`, `all`), `src/server/preferenceStore.ts` (JSON preferences by scope and key) | |
| SPA | `src/server/spa.ts` (`APP_ROUTES`, `isClientRoutePath`), `src/main.tsx` (`BrowserRouter`), `src/App.tsx` (`Tab`, `TAB_ROUTES`, `tabs`, body classes `tab-*`) | |
| UI | `src/components/views/GoalsView.tsx`, `src/components/views/GoalsLoadingState.tsx`, `src/components/modals/GoalProposalsModal.tsx`, `src/components/common/RepositoryPicker.tsx`, `RepositoryContentSources.tsx`, `ContentSourcePicker.tsx`, `src/components/preferences/AiIntegrationSettings.tsx` | |
| Client API | `src/api/github.ts` (`fetchGoals`, `createGoal`, `deleteGoal`, `generateGoalAdvice`, `fetchGoalProposals`, content sources) | |
| Pure utils and tests | `src/utils/goals.ts`, `src/utils/socialProposals.ts`; `tests/utils/goals.test.ts`, `tests/utils/socialProposals.test.ts`, `tests/server/aiClient.test.ts`, `tests/server/aiSettings.test.ts` | |
| Styles | `src/styles/goals.css`, `src/styles/layout-sidebar.css`, `src/styles/navigation.css`, `src/styles/tokens.css` | |
| Scripts | `package.json`: `dev`, `build`, `test` (vitest run), `typecheck` | |

## 5. Target architecture

### 5.1 Shell and routing

- `src/main.tsx` mounts `GrowthStudioApp` when `location.pathname` starts with
  `/growth`, otherwise `App`. Both share the providers (i18n, accounts).
  Authentication reuses the existing auth state and `AuthGate`.
- `src/server/spa.ts` treats every `/growth` and `/growth/...` path as a client
  route. `/goals` stays in `APP_ROUTES` and the client redirects it to
  `/growth`.
- Routes:
  - `/growth` — home: repositories with a growth profile or active goals, quick
    stats, "open workspace", "unified calendar".
  - `/growth/calendar` — unified calendar (all repositories).
  - `/growth/review` — latest Growth Review across repositories.
  - `/growth/r/:owner/:repo` — workspace overview.
  - `/growth/r/:owner/:repo/missions|interventions|calendar|library|review`.
  - `/growth/settings` — growth-wide preferences (default cadence, default
    pillars, timezone), linking to the existing AI preferences page.
- Components live under `src/components/growth/` (shell, sidebar, top bar,
  panels) and `src/components/growth/calendar/`. Styles under
  `src/styles/growth/*.css`, imported from `src/styles.css`. Body class
  `mode-growth` is set by the shell; dashboard styles must not leak into it.
- The main application replaces the `goals` tab with an anchor styled as a tab
  that opens `/growth` in a new window. The `Tab` union loses `goals`; the
  `GoalsView` component moves into the Missions panel of the workspace.

### 5.2 Data model (SQLite, `src/server/growth/store.ts`)

All tables carry `account_id` and use the same account scoping as goals.

- `growth_profiles` (PK `account_id, repository`): `language`, `voice`,
  `audience`, `channels` JSON (`x`, `linkedin`, `mastodon`, `bluesky`,
  `discussion`, `blog`), `cadence` JSON (`{ channel: postsPerWeek }`),
  `pillars` JSON (`[{ id, label, weight, description }]`), `hashtags` JSON,
  `avoid` TEXT, `timezone`, `posting_windows` JSON (`[{ weekday, hour }]`),
  `color` (calendar color), `updated_at`.
- `growth_interventions`: `id`, `account_id`, `repository`, `goal_id` NULL,
  `category` (`product|community|engineering|marketing`), `title`, `action`,
  `origin` (`ai|rule|manual`), `rule_key` NULL, `dedupe_key`, `status`
  (`proposed|accepted|dismissed|done`), `created_at`, `updated_at`.
- `content_plans`: `id`, `account_id`, `repository`, `period_start`,
  `period_end`, `cadence` JSON snapshot, `pillars` JSON snapshot, `status`
  (`draft|active|archived`), `generated_at`, `created_at`.
- `content_items`: `id`, `account_id`, `repository`, `plan_id` NULL,
  `intervention_id` NULL, `goal_ids` JSON, `channel`, `format` (existing
  `GoalProposalFormat` values), `pillar`, `angle` (one-line brief), `title`,
  `summary`, `body` (markdown), `thread_posts` JSON, `media` JSON
  (`[{ assetId?, url?, kind, alt, caption? }]`), `sources` JSON (URLs cited),
  `status` (`idea|draft|ready|scheduled|published|skipped`), `scheduled_for`
  (ISO datetime, NULL for backlog), `published_at`, `published_url`,
  `generated_at`, `generation_version`, `evergreen` INTEGER (0/1),
  `created_at`, `updated_at`.
- `growth_assets`: `id`, `account_id`, `repository`, `kind` (`image|video`),
  `origin` (`upload|readme|website|generated`), `path` (relative to
  `DATA_DIR/growth-assets/`) or `url`, `title`, `alt`, `width`, `height`,
  `card_template` NULL, `card_data` JSON NULL, `created_at`.
- `content_performance`: `content_id`, `window` (`48h|7d`), `measured_at`,
  `metrics` JSON (`{ starsDelta, forksDelta, ... }`), PK (`content_id`,
  `window`).

Migration (one shot, idempotent, at first store access): every
`GoalSuggestion` in `repository_goals.suggestions` becomes a
`growth_interventions` row with `origin='ai'`, `status='proposed'`,
`goal_id` set, and each `GoalProposal` a `content_items` row with
`status='draft'` linked to that intervention. The JSON column is left in place
and no longer written. A `preferences` row (`growth`, `migratedSuggestionsV1`)
records completion.

### 5.3 Server modules (`src/server/growth/`)

- `store.ts` — schema, CRUD, migration.
- `signals.ts` — collects repository signals for AI prompts: repo metadata,
  open issues and PRs, releases, README excerpt and media URLs, content
  sources (move the fetchers out of `src/server/goals.ts`; keep the SSRF
  guards), recent commits (`/repos/:repo/commits?per_page=20`), star history
  from snapshots, goals with progress.
- `planner.ts` — builds a plan: deterministic slots from
  `src/utils/growth/planSlots.ts`, then one `generateStructured` call assigns
  an angle, pillar confirmation, sources and CTA to each slot; slots become
  `content_items` with `status='idea'`.
- `drafter.ts` — turns one idea into a draft (body, thread posts, media
  candidates from assets and signal media, alt text) with the platform rules
  already in `src/utils/socialProposals.ts`.
- `rules.ts` + `src/utils/growth/opportunityRules.ts` — deterministic
  opportunity detection producing interventions with `origin='rule'`:
  release without a post within 3 days; star milestone within 5 percent;
  unanswered good-first-issues older than 14 days; large PR merged without a
  post; goal overdue risk (pace below required); evergreen content older than
  60 days eligible for recycling.
- `attribution.ts` — computes `content_performance` from snapshots at 48h and
  7d after `published_at`; aggregates per pillar and channel.
- `review.ts` — weekly Growth Review: published items, deltas, misses,
  upcoming week, three proposed interventions; AI narrative optional.
- `cards.ts` — SVG templates for generated cards (release, milestone, stats,
  quote, "what's new"); returns SVG strings, the browser rasterizes.
- Routes in `src/server/routes/growth.ts`, prefix `/api/growth/`.

### 5.4 Client

- `src/api/growth.ts` — typed fetchers for all growth endpoints.
- Panels: Home, Workspace overview, Missions (existing goals UI), Interventions
  (backlog with filters and status actions), Calendar (month and week, drag
  and drop reschedule, item drawer), Queue ("this week" list with copy text,
  copy or download image, mark published), Library (sources, assets, profile,
  pillars and cadence), Review.
- Media copy: `navigator.clipboard.write([new ClipboardItem({ "image/png": blob })])`
  with a download fallback. SVG cards are rendered to a canvas at 2x.
- ICS export endpoint `/api/growth/calendar.ics` for scheduled items.

### 5.5 Unified calendar

Same Calendar component without a repository filter: colour per repository
(`growth_profiles.color`), repository chip on each item, filters by
repository, channel, pillar and status. Multi-repository plan generation
staggers release-type items so two repositories never publish the same pillar
on the same day when avoidable.

## 6. Phases and task numbering

Task IDs are `GS-NNN`. Tens group phases. The last task of a phase authors the
next phase's task files and `PENDING` ledger rows when they do not exist yet.

| Phase | Tasks | Scope |
|---|---|---|
| 0 Governance | GS-000..GS-003 | baseline, inventory verification, decisions, gate baseline |
| 1 Shell | GS-010..GS-016 | `/growth` routing, shell chrome, main-menu link, `/goals` redirect, Missions panel, home and workspace overview |
| 2 Data model | GS-020..GS-026 | growth store and migration, API routes, interventions backlog UI, content items UI, profile and library panel, phase 3 authoring |
| 3 Editorial plan | GS-030..GS-03x | pillars and cadence UI, slot builder, AI planner, drafter, calendar views, queue, mark published, ICS |
| 4 Media | GS-040..GS-04x | assets library, imports from README and web sources, card templates, client rasterization and clipboard copy, media gate for `ready` |
| 5 Loop | GS-050..GS-05x | opportunity rules, attribution, Growth Review, evergreen recycling, plan re-weighting |
| 6 Unified and release | GS-060..GS-06x | unified calendar, multi-repository deconfliction, growth settings, README and CHANGELOG, final QA |

## 7. Standard task loop (every session)

1. Read the task file, this plan, `GS_FEATURE_MATRIX.md`, `GS_DECISIONS.md`
   and `PROGRESS.md`.
2. Inspect `git status`; preserve unrelated changes, never discard user work.
3. Set the task to `IN_PROGRESS` in `PROGRESS.md`.
4. Study the existing code listed in section 4 for the touched area before
   writing new code. Extend existing helpers instead of duplicating them.
5. Implement the smallest complete change for the task scope only. Add keys to
   both locale files. Put pure logic in `src/utils` with tests in `tests/utils`.
6. Run the validation gate: `growth-studio-project/scripts/validate-gs-task.sh`.
   It must end with `VALIDATION OK`.
7. Update `GS_FEATURE_MATRIX.md` rows touched by the task, and
   `GS_DECISIONS.md` when a task had to settle something new.
8. Review `git diff` and `git diff --check`.
9. Set the task to `COMPLETED` in `PROGRESS.md` with a one-line summary,
   verification evidence, and ISO date. Never use `|` inside fields.
10. Create the task's single conventional commit with scope `growth`, e.g.
    `feat(growth): add the /growth shell and navigation`. No push. No
    `Co-Authored-By` trailer.
11. If blocked, set the task to `BLOCKED` with the blocker, leave the repo in a
    safe state, and stop without claiming completion.

## 8. Quality bar

- Every server endpoint validates input and scopes by account, like
  `src/server/routes/goals.ts`.
- Every fetch of a user-supplied URL goes through the SSRF guards in
  `signals.ts`.
- AI calls use `generateStructured` with a JSON schema and a deterministic
  fallback when AI is not configured, like `fallbackSuggestions` today.
- UI states: loading, empty, error and "AI not configured" for every panel.
- Keyboard: Escape closes drawers and modals; calendar items are focusable.
- Dark and light themes via existing tokens in `src/styles/tokens.css`.
