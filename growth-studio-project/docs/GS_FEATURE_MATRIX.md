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
| AI suggestions per goal (3–5 actions); four deterministic actions when AI is not configured | `src/server/goals.ts` `generateGoalSuggestions`, `src/server/growth/signals.ts`, `src/server/goalStore.ts` compatibility projection, `src/server/growth/store.ts` interventions, `src/components/growth/GrowthInterventions.tsx` | EXISTING | GS-021 and GS-023 |
| AI proposals per suggestion (X thread, LinkedIn, Mastodon) with source-backed media suggestions when assets are available | `src/server/goals.ts` `generateGoalProposals`, `src/server/growth/signals.ts`, `src/utils/socialProposals.ts`, `src/server/goalStore.ts` compatibility projection, `src/server/growth/store.ts` content items, `src/components/modals/GoalProposalsModal.tsx`, `/api/growth/content/draft` | EXISTING | GS-021, GS-023, and GS-024 |
| Repository content sources (repositories and websites) with SSRF-guarded website reads during generation | `src/server/goalStore.ts`, `src/server/routes/repository.ts`, `src/server/growth/signals.ts`, `src/api/github.ts`, `src/components/growth/GrowthLibrary.tsx`, `src/components/common/RepositoryContentSources.tsx`, `src/components/common/ContentSourcePicker.tsx`, `src/utils/socialProposals.ts` | EXISTING | GS-023 and GS-025 |
| AI provider settings and connection test | `src/components/preferences/AiIntegrationSettings.tsx`, `src/api/github.ts`, `src/server/routes/ai.ts`, `src/server/ai/client.ts`, `src/server/ai/settings.ts`, `src/server/ai/providers.ts` | EXISTING | — |
| `/growth` client routes served by the SPA | `src/server/spa.ts`, `src/main.tsx`, `src/components/growth/GrowthStudioApp.tsx`, `tests/server/spa.test.ts` | DONE | GS-010 |
| Growth shell: own top bar, sidebar, `mode-growth` body class, no dashboard chrome | `src/components/growth/GrowthStudioApp.tsx`, `src/components/growth/GrowthTopBar.tsx`, `src/components/growth/GrowthSidebar.tsx`, `src/styles/growth/shell.css` | DONE | GS-011 |
| Main-menu entry opening `/growth` in a new window; `goals` tab removed; `/goals` redirect | `src/App.tsx`, `src/main.tsx`, `src/utils/dataRequirements.ts`, `src/components/SidebarControls.tsx` | DONE | GS-012 |
| Missions panel hosting the existing goals UI | `src/components/growth/GrowthStudioApp.tsx`, `src/hooks/useGoals.ts`, `src/components/views/GoalsView.tsx` | DONE | GS-013 |
| Growth home: repositories with profiles or goals, quick stats | `src/components/growth/GrowthHome.tsx`, `src/utils/growthHome.ts`, `/api/growth/workspaces`, `/growth` | DONE | GS-014 and GS-022 |
| Workspace overview per repository | `src/components/growth/GrowthWorkspaceOverview.tsx`, `src/types/growth.ts`, `src/api/growth.ts`, `/api/growth/workspace/:owner/:repo`, `/growth/r/:owner/:repo` | DONE | GS-015 and GS-022 |
| Shell i18n, responsive layout, theme parity, and keyboard dismissal | `src/components/growth/`, `src/components/common/RepositoryPicker.tsx`, `src/styles/growth/`, `src/i18n/en.ts`, `src/i18n/it.ts` | DONE | GS-016 |
| Growth Studio introduction and screenshot placeholder | `README.md` | DONE | GS-016 |
| Growth store schema (profiles, interventions, plans, items, assets, performance) | `src/server/growth/store.ts`, `src/types/growth.ts`, `src/utils/growth/profileDefaults.ts`, `tests/server/growthStore.test.ts` | DONE | GS-020 |
| One-shot migration of legacy suggestions and proposals | `src/server/growth/store.ts`, `src/utils/growth/legacySuggestions.ts`, `tests/server/growthStore.test.ts` | DONE | GS-021 |
| Growth API routes and account-wide workspace summaries | `src/server/routes/growth.ts`, `src/server/growth/store.ts`, `src/api/growth.ts`, `tests/server/growthRoutes.test.ts` | DONE | GS-022 |
| Shared repository signal collection with SSRF-guarded sources | `src/server/growth/signals.ts`, `src/server/snapshots.ts`, `tests/server/growthSignals.test.ts` | DONE | GS-023 |
| Interventions backlog with statuses, AI and fallback generation, dedupe, manual creation, filters, and linked content | `src/components/growth/GrowthInterventions.tsx`, `src/server/routes/growth.ts`, `src/server/growth/store.ts`, `/growth/r/:owner/:repo/interventions` | DONE | GS-023 |
| Content items list and drawer with editing, copy, scheduling, and publication actions | `src/components/growth/ContentItemDrawer.tsx`, `src/components/growth/GrowthInterventions.tsx`, `/api/growth/content/draft`; later reused by Calendar | DONE | GS-024 |
| Library panel: sources, profile (voice, audience, channels), pillars, cadence | `src/components/growth/GrowthLibrary.tsx`, `src/utils/growth/profile.ts`, `/growth/r/:owner/:repo/library`, `/api/growth/profiles/:owner/:repo` | DONE | GS-025 |
| Phase 2 closure and phase 3 task authoring | `growth-studio-project/tasks/GS-030.md` through `GS-038.md`, `growth-studio-project/tasks/PROGRESS.md`, `growth-studio-project/docs/GS_DECISIONS.md` | DONE | GS-026 |
| Deterministic slot builder from cadence, pillars, posting windows | `src/types/growth.ts`, `src/utils/growth/planSlots.ts`, `tests/utils/growth/planSlots.test.ts` | DONE | GS-030 |
| AI planner assigning angles to slots | `src/server/growth/planner.ts`, `/api/growth/plans`, `/api/growth/plans/generate` | PLANNED | GS-031 |
| AI drafter producing media-aware drafts per slot | `src/server/growth/drafter.ts`, `src/utils/growth/mediaCandidates.ts`, `/api/growth/content/:id/draft` | PLANNED | GS-032 |
| Calendar month and week views with drag and drop | `src/components/growth/calendar/`, `src/utils/growth/calendar.ts`, `/growth/r/:owner/:repo/calendar` | PLANNED | GS-033 and GS-034 |
| Queue "this week" with copy and mark published | `src/components/growth/calendar/GrowthQueue.tsx`, `/growth/r/:owner/:repo/calendar?view=queue` | PLANNED | GS-035 |
| ICS export | `src/utils/growth/ics.ts`, `/api/growth/calendar.ics` | PLANNED | GS-036 |
| Content plan create, regenerate, and archive management | `src/components/growth/calendar/GrowthPlanManager.tsx`, `/api/growth/plans/:id/regenerate`, `/api/growth/plans/:id/archive` | PLANNED | GS-037 |
| Assets library with uploads and imports from README and web sources | `server/growth/assets.ts` | PLANNED | Phase 4 |
| Generated SVG cards (release, milestone, stats, quote, what's new) | `server/growth/cards.ts` | PLANNED | Phase 4 |
| Client rasterization, copy image to clipboard, download | `utils/growth/rasterize.ts` | PLANNED | Phase 4 |
| Media gate: `ready`, `scheduled`, and `published` require media | `src/server/growth/store.ts`, `src/components/growth/ContentItemDrawer.tsx`, `tests/server/growthStore.test.ts`, `tests/server/growthRoutes.test.ts` | DONE | GS-020 and GS-024 |
| Media attachment and removal UI | `src/components/growth/ContentItemDrawer.tsx`, asset library | PLANNED | Phase 4 |
| Opportunity rules producing interventions | `utils/growth/opportunityRules.ts`, `server/growth/rules.ts` | PLANNED | Phase 5 |
| Attribution of published items to metric deltas (48h, 7d) | `server/growth/attribution.ts` | PLANNED | Phase 5 |
| Weekly Growth Review | `server/growth/review.ts`, `/growth/review` | PLANNED | Phase 5 |
| Evergreen recycling | planner and rules | PLANNED | Phase 5 |
| Plan re-weighting from performance | planner | PLANNED | Phase 5 |
| Unified calendar with per-repository colours and filters | `/growth/calendar` | PLANNED | Phase 6 |
| Multi-repository deconfliction | planner | PLANNED | Phase 6 |
| Growth settings (defaults, timezone) | `/growth/settings` | PLANNED | Phase 6 |
| Release documentation, CHANGELOG and final screenshots | `README.md`, `CHANGELOG.md` | PLANNED | Phase 6 |
