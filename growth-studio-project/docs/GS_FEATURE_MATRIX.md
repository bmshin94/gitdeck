# Growth Studio feature matrix

Authoritative inventory of Growth Studio capabilities. Statuses: `EXISTING`
(present before the project, may move), `PLANNED`, `IN_PROGRESS`, `DONE`,
`DROPPED`. Tasks update the rows they touch.

| Feature | Location (current or target) | Status | Task |
|---|---|---|---|
| Governance baseline and validation gate | `growth-studio-project/scripts/`, `src/utils/colors.ts`, `tests/utils/colors.test.ts` | DONE | GS-000 |
| Validation guards for test placement and English/Italian locale key parity | `growth-studio-project/scripts/validate-gs-task.sh`, `growth-studio-project/scripts/check-i18n-key-parity.mjs` | DONE | GS-003 |
| Phase 1 and phase 2 implementation decisions | `growth-studio-project/docs/GS_DECISIONS.md` | DONE | GS-002 |
| Goals CRUD with metric refresh (stars, forks, closed PRs, downloads) | `src/components/views/GoalsView.tsx`, `src/api/github.ts`, `src/server/goalStore.ts`, `src/server/goals.ts`, `src/server/routes/goals.ts` | EXISTING | — |
| AI suggestions per goal (3–5 actions); four deterministic actions when AI is not configured | `src/server/goals.ts` `generateGoalSuggestions`, `src/server/goalStore.ts` `saveGoalSuggestions`, `src/components/views/GoalsView.tsx` | EXISTING | GS-021 migrates |
| AI proposals per suggestion (X thread, LinkedIn, Mastodon) with source-backed media suggestions when assets are available | `src/server/goals.ts` `generateGoalProposals`, `src/utils/socialProposals.ts`, `src/server/goalStore.ts` `saveGoalProposals`, `src/components/modals/GoalProposalsModal.tsx` | EXISTING | GS-021 migrates |
| Repository content sources (repositories and websites) with SSRF-guarded website reads during generation | `src/server/goalStore.ts`, `src/server/routes/repository.ts`, `src/server/goals.ts`, `src/api/github.ts`, `src/components/common/RepositoryContentSources.tsx`, `src/components/common/ContentSourcePicker.tsx`, `src/utils/socialProposals.ts` | EXISTING | GS-025 moves to Library |
| AI provider settings and connection test | `src/components/preferences/AiIntegrationSettings.tsx`, `src/api/github.ts`, `src/server/routes/ai.ts`, `src/server/ai/client.ts`, `src/server/ai/settings.ts`, `src/server/ai/providers.ts` | EXISTING | — |
| `/growth` client routes served by the SPA | `src/server/spa.ts`, `src/main.tsx`, `src/components/growth/GrowthStudioApp.tsx`, `tests/server/spa.test.ts` | DONE | GS-010 |
| Growth shell: own top bar, sidebar, `mode-growth` body class, no dashboard chrome | `src/components/growth/GrowthStudioApp.tsx`, `src/components/growth/GrowthTopBar.tsx`, `src/components/growth/GrowthSidebar.tsx`, `src/styles/growth/shell.css` | DONE | GS-011 |
| Main-menu entry opening `/growth` in a new window; `goals` tab removed; `/goals` redirect | `App.tsx` | PLANNED | GS-012 |
| Missions panel hosting the existing goals UI | `/growth/r/:owner/:repo/missions` | PLANNED | GS-013 |
| Growth home: repositories with profiles or goals, quick stats | `/growth` | PLANNED | GS-014 |
| Workspace overview per repository | `/growth/r/:owner/:repo` | PLANNED | GS-015 |
| Shell i18n, responsive layout, theme parity | shell components | PLANNED | GS-016 |
| Growth store schema (profiles, interventions, plans, items, assets, performance) | `server/growth/store.ts` | PLANNED | GS-020 |
| One-shot migration of legacy suggestions and proposals | `server/growth/store.ts` | PLANNED | GS-021 |
| Growth API routes | `server/routes/growth.ts`, `api/growth.ts` | PLANNED | GS-022 |
| Interventions backlog with statuses and manual creation | `/growth/r/:owner/:repo/interventions` | PLANNED | GS-023 |
| Content items list and drawer with copy actions | Interventions and Calendar panels | PLANNED | GS-024 |
| Library panel: sources, profile (voice, audience, channels), pillars, cadence | `/growth/r/:owner/:repo/library` | PLANNED | GS-025 |
| Deterministic slot builder from cadence, pillars, posting windows | `utils/growth/planSlots.ts` | PLANNED | Phase 3 |
| AI planner assigning angles to slots | `server/growth/planner.ts` | PLANNED | Phase 3 |
| AI drafter producing media-aware drafts per slot | `server/growth/drafter.ts` | PLANNED | Phase 3 |
| Calendar month and week views with drag and drop | `components/growth/calendar/` | PLANNED | Phase 3 |
| Queue "this week" with copy and mark published | Calendar panel | PLANNED | Phase 3 |
| ICS export | `/api/growth/calendar.ics` | PLANNED | Phase 3 |
| Assets library with uploads and imports from README and web sources | `server/growth/assets.ts` | PLANNED | Phase 4 |
| Generated SVG cards (release, milestone, stats, quote, what's new) | `server/growth/cards.ts` | PLANNED | Phase 4 |
| Client rasterization, copy image to clipboard, download | `utils/growth/rasterize.ts` | PLANNED | Phase 4 |
| Media gate: `ready` requires media | store and UI | PLANNED | Phase 4 |
| Opportunity rules producing interventions | `utils/growth/opportunityRules.ts`, `server/growth/rules.ts` | PLANNED | Phase 5 |
| Attribution of published items to metric deltas (48h, 7d) | `server/growth/attribution.ts` | PLANNED | Phase 5 |
| Weekly Growth Review | `server/growth/review.ts`, `/growth/review` | PLANNED | Phase 5 |
| Evergreen recycling | planner and rules | PLANNED | Phase 5 |
| Plan re-weighting from performance | planner | PLANNED | Phase 5 |
| Unified calendar with per-repository colours and filters | `/growth/calendar` | PLANNED | Phase 6 |
| Multi-repository deconfliction | planner | PLANNED | Phase 6 |
| Growth settings (defaults, timezone) | `/growth/settings` | PLANNED | Phase 6 |
| README, CHANGELOG and screenshots | `README.md`, `CHANGELOG.md` | PLANNED | Phase 6 |
