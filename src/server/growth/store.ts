import { randomUUID } from "node:crypto";
import type {
  CreateGrowthContentItemInput,
  CreateGrowthContentPlanInput,
  CreateGrowthInterventionInput,
  GrowthContentItem,
  GrowthContentItemFilters,
  GrowthContentItemStatus,
  GrowthContentMedia,
  GrowthContentPlan,
  GrowthContentPlanStatus,
  GrowthIntervention,
  GrowthInterventionCategory,
  GrowthInterventionFilters,
  GrowthInterventionOrigin,
  GrowthInterventionStatus,
  GrowthPillar,
  GrowthPostingWindow,
  GrowthProfile,
  GrowthProfileInput,
  UpdateGrowthContentItemInput,
} from "../../types/growth";
import {
  GOAL_PROPOSAL_FORMATS,
  type GoalProposal,
  type GoalProposalFormat,
  type GoalSuggestion,
} from "../../types/goals";
import {
  createLegacySuggestionDedupeKey,
  legacyMediaToContentMedia,
  legacyProposalChannel,
} from "../../utils/growth/legacySuggestions";
import {
  createDefaultGrowthProfile,
  DEFAULT_GROWTH_CADENCE,
} from "../../utils/growth/profileDefaults";
import { getPreference, setPreference } from "../preferenceStore";
import { all, get, getDatabase, run } from "../sqlite";

interface GrowthProfileRow {
  account_id: string;
  repository: string;
  language: string;
  voice: string;
  audience: string;
  channels: string;
  cadence: string;
  pillars: string;
  hashtags: string;
  avoid: string;
  timezone: string;
  posting_windows: string;
  color: string;
  updated_at: string;
}

interface GrowthInterventionRow {
  id: string;
  account_id: string;
  repository: string;
  goal_id: string | null;
  category: GrowthInterventionCategory;
  title: string;
  action: string;
  origin: GrowthInterventionOrigin;
  rule_key: string | null;
  dedupe_key: string;
  status: GrowthInterventionStatus;
  created_at: string;
  updated_at: string;
}

interface GrowthContentPlanRow {
  id: string;
  account_id: string;
  repository: string;
  period_start: string;
  period_end: string;
  cadence: string;
  pillars: string;
  status: GrowthContentPlanStatus;
  generated_at: string;
  created_at: string;
}

interface GrowthContentItemRow {
  id: string;
  account_id: string;
  repository: string;
  plan_id: string | null;
  intervention_id: string | null;
  goal_ids: string;
  channel: GrowthContentItem["channel"];
  format: GoalProposalFormat;
  pillar: string;
  angle: string;
  title: string;
  summary: string;
  body: string;
  thread_posts: string;
  media: string;
  sources: string;
  status: GrowthContentItemStatus;
  scheduled_for: string | null;
  published_at: string | null;
  published_url: string | null;
  generated_at: string | null;
  generation_version: number;
  evergreen: number;
  created_at: string;
  updated_at: string;
}

const MEDIA_REQUIRED_STATUSES = new Set<GrowthContentItemStatus>(["ready", "scheduled", "published"]);

export class GrowthStoreValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GrowthStoreValidationError";
  }
}

export class MediaRequiredError extends GrowthStoreValidationError {
  constructor() {
    super("Content must have at least one media attachment before it can be ready, scheduled, or published.");
    this.name = "MediaRequiredError";
  }
}

export class ScheduleRequiredError extends GrowthStoreValidationError {
  constructor() {
    super("Scheduled content requires a valid ISO date and time.");
    this.name = "ScheduleRequiredError";
  }
}

export class InvalidPublishedUrlError extends GrowthStoreValidationError {
  constructor() {
    super("Published URL must use HTTP or HTTPS.");
    this.name = "InvalidPublishedUrlError";
  }
}

export function ensureGrowthSchema(): void {
  getDatabase().exec(`
    CREATE TABLE IF NOT EXISTS growth_profiles (
      account_id TEXT NOT NULL,
      repository TEXT NOT NULL,
      language TEXT NOT NULL,
      voice TEXT NOT NULL,
      audience TEXT NOT NULL,
      channels TEXT NOT NULL,
      cadence TEXT NOT NULL,
      pillars TEXT NOT NULL,
      hashtags TEXT NOT NULL,
      avoid TEXT NOT NULL,
      timezone TEXT NOT NULL,
      posting_windows TEXT NOT NULL,
      color TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (account_id, repository)
    );

    CREATE TABLE IF NOT EXISTS growth_interventions (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      repository TEXT NOT NULL,
      goal_id TEXT,
      category TEXT NOT NULL CHECK(category IN ('product', 'community', 'engineering', 'marketing')),
      title TEXT NOT NULL,
      action TEXT NOT NULL,
      origin TEXT NOT NULL CHECK(origin IN ('ai', 'rule', 'manual')),
      rule_key TEXT,
      dedupe_key TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('proposed', 'accepted', 'dismissed', 'done')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS content_plans (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      repository TEXT NOT NULL,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      cadence TEXT NOT NULL,
      pillars TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('draft', 'active', 'archived')),
      generated_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS content_items (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      repository TEXT NOT NULL,
      plan_id TEXT REFERENCES content_plans(id) ON DELETE SET NULL,
      intervention_id TEXT REFERENCES growth_interventions(id) ON DELETE SET NULL,
      goal_ids TEXT NOT NULL,
      channel TEXT NOT NULL CHECK(channel IN ('x', 'linkedin', 'mastodon', 'bluesky', 'discussion', 'blog', 'other')),
      format TEXT NOT NULL CHECK(format IN ('x-thread', 'linkedin-post', 'mastodon-post', 'post', 'issue', 'discussion', 'email', 'checklist', 'message', 'doc')),
      pillar TEXT NOT NULL,
      angle TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      body TEXT NOT NULL,
      thread_posts TEXT NOT NULL,
      media TEXT NOT NULL,
      sources TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('idea', 'draft', 'ready', 'scheduled', 'published', 'skipped')),
      scheduled_for TEXT,
      published_at TEXT,
      published_url TEXT,
      generated_at TEXT,
      generation_version INTEGER NOT NULL,
      evergreen INTEGER NOT NULL DEFAULT 0 CHECK(evergreen IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS growth_assets (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      repository TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('image', 'video')),
      origin TEXT NOT NULL CHECK(origin IN ('upload', 'readme', 'website', 'generated')),
      path TEXT,
      url TEXT,
      title TEXT NOT NULL,
      alt TEXT NOT NULL,
      width INTEGER,
      height INTEGER,
      card_template TEXT,
      card_data TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS content_performance (
      account_id TEXT NOT NULL,
      content_id TEXT NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
      "window" TEXT NOT NULL CHECK("window" IN ('48h', '7d')),
      measured_at TEXT NOT NULL,
      metrics TEXT NOT NULL,
      PRIMARY KEY (content_id, "window")
    );

    CREATE INDEX IF NOT EXISTS growth_profiles_account_repository
      ON growth_profiles(account_id, repository);
    CREATE INDEX IF NOT EXISTS growth_interventions_account_repository
      ON growth_interventions(account_id, repository);
    CREATE INDEX IF NOT EXISTS content_plans_account_repository
      ON content_plans(account_id, repository);
    CREATE INDEX IF NOT EXISTS content_items_account_repository
      ON content_items(account_id, repository);
    CREATE INDEX IF NOT EXISTS growth_assets_account_repository
      ON growth_assets(account_id, repository);
    CREATE INDEX IF NOT EXISTS content_items_account_scheduled_for
      ON content_items(account_id, scheduled_for);
    CREATE INDEX IF NOT EXISTS content_performance_account_content
      ON content_performance(account_id, content_id);
  `);
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function profileFromRow(row: GrowthProfileRow): GrowthProfile {
  const defaults = createDefaultGrowthProfile(row.account_id, row.repository);
  return {
    accountId: row.account_id,
    repository: row.repository,
    language: row.language,
    voice: row.voice,
    audience: row.audience,
    channels: parseJson(row.channels, defaults.channels),
    cadence: parseJson(row.cadence, defaults.cadence),
    pillars: parseJson(row.pillars, defaults.pillars),
    hashtags: parseJson(row.hashtags, [] as string[]),
    avoid: row.avoid,
    timezone: row.timezone,
    postingWindows: parseJson(row.posting_windows, [] as GrowthPostingWindow[]),
    color: row.color,
    updatedAt: row.updated_at,
  };
}

export function getGrowthProfile(accountId: string, repository: string): GrowthProfile {
  ensureGrowthAccountMigration(accountId);
  const row = get<GrowthProfileRow>(
    "SELECT * FROM growth_profiles WHERE account_id = ? AND repository = ?",
    [accountId, repository],
  );
  return row ? profileFromRow(row) : createDefaultGrowthProfile(accountId, repository);
}

export function upsertGrowthProfile(
  accountId: string,
  repository: string,
  input: GrowthProfileInput,
): GrowthProfile {
  ensureGrowthAccountMigration(accountId);
  const now = new Date().toISOString();
  run(
    `INSERT INTO growth_profiles
      (account_id, repository, language, voice, audience, channels, cadence, pillars, hashtags, avoid, timezone, posting_windows, color, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(account_id, repository) DO UPDATE SET
       language = excluded.language,
       voice = excluded.voice,
       audience = excluded.audience,
       channels = excluded.channels,
       cadence = excluded.cadence,
       pillars = excluded.pillars,
       hashtags = excluded.hashtags,
       avoid = excluded.avoid,
       timezone = excluded.timezone,
       posting_windows = excluded.posting_windows,
       color = excluded.color,
       updated_at = excluded.updated_at`,
    [
      accountId,
      repository,
      input.language,
      input.voice,
      input.audience,
      JSON.stringify(input.channels),
      JSON.stringify(input.cadence),
      JSON.stringify(input.pillars),
      JSON.stringify(input.hashtags),
      input.avoid,
      input.timezone,
      JSON.stringify(input.postingWindows),
      input.color,
      now,
    ],
  );
  return getGrowthProfile(accountId, repository);
}

function interventionFromRow(row: GrowthInterventionRow): GrowthIntervention {
  return {
    id: row.id,
    accountId: row.account_id,
    repository: row.repository,
    goalId: row.goal_id,
    category: row.category,
    title: row.title,
    action: row.action,
    origin: row.origin,
    ruleKey: row.rule_key,
    dedupeKey: row.dedupe_key,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function findGrowthIntervention(accountId: string, id: string): GrowthIntervention | null {
  ensureGrowthAccountMigration(accountId);
  const row = get<GrowthInterventionRow>(
    "SELECT * FROM growth_interventions WHERE account_id = ? AND id = ?",
    [accountId, id],
  );
  return row ? interventionFromRow(row) : null;
}

export function listGrowthInterventions(
  accountId: string,
  filters: GrowthInterventionFilters = {},
): GrowthIntervention[] {
  ensureGrowthAccountMigration(accountId);
  const clauses = ["account_id = ?"];
  const params: unknown[] = [accountId];
  if (filters.repository !== undefined) {
    clauses.push("repository = ?");
    params.push(filters.repository);
  }
  if (Object.prototype.hasOwnProperty.call(filters, "goalId")) {
    if (filters.goalId === null) clauses.push("goal_id IS NULL");
    else {
      clauses.push("goal_id = ?");
      params.push(filters.goalId);
    }
  }
  if (filters.status !== undefined) {
    clauses.push("status = ?");
    params.push(filters.status);
  }
  return all<GrowthInterventionRow>(
    `SELECT * FROM growth_interventions WHERE ${clauses.join(" AND ")} ORDER BY created_at, id`,
    params,
  ).map(interventionFromRow);
}

export function createGrowthIntervention(input: CreateGrowthInterventionInput): GrowthIntervention {
  ensureGrowthAccountMigration(input.accountId);
  const id = randomUUID();
  const now = new Date().toISOString();
  run(
    `INSERT INTO growth_interventions
      (id, account_id, repository, goal_id, category, title, action, origin, rule_key, dedupe_key, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.accountId,
      input.repository,
      input.goalId ?? null,
      input.category,
      input.title,
      input.action,
      input.origin,
      input.ruleKey ?? null,
      input.dedupeKey,
      input.status ?? "proposed",
      now,
      now,
    ],
  );
  return findGrowthIntervention(input.accountId, id)!;
}

export function updateGrowthInterventionStatus(
  accountId: string,
  id: string,
  status: GrowthInterventionStatus,
): GrowthIntervention | null {
  ensureGrowthAccountMigration(accountId);
  const result = run(
    "UPDATE growth_interventions SET status = ?, updated_at = ? WHERE account_id = ? AND id = ?",
    [status, new Date().toISOString(), accountId, id],
  );
  return result.changes > 0 ? findGrowthIntervention(accountId, id) : null;
}

function contentPlanFromRow(row: GrowthContentPlanRow): GrowthContentPlan {
  return {
    id: row.id,
    accountId: row.account_id,
    repository: row.repository,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    cadence: parseJson(row.cadence, { ...DEFAULT_GROWTH_CADENCE }),
    pillars: parseJson(row.pillars, [] as GrowthPillar[]),
    status: row.status,
    generatedAt: row.generated_at,
    createdAt: row.created_at,
  };
}

function findContentPlan(accountId: string, id: string): GrowthContentPlan | null {
  ensureGrowthAccountMigration(accountId);
  const row = get<GrowthContentPlanRow>(
    "SELECT * FROM content_plans WHERE account_id = ? AND id = ?",
    [accountId, id],
  );
  return row ? contentPlanFromRow(row) : null;
}

export function createContentPlan(input: CreateGrowthContentPlanInput): GrowthContentPlan {
  ensureGrowthAccountMigration(input.accountId);
  const id = randomUUID();
  const now = new Date().toISOString();
  run(
    `INSERT INTO content_plans
      (id, account_id, repository, period_start, period_end, cadence, pillars, status, generated_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.accountId,
      input.repository,
      input.periodStart,
      input.periodEnd,
      JSON.stringify(input.cadence),
      JSON.stringify(input.pillars),
      input.status ?? "draft",
      input.generatedAt ?? now,
      now,
    ],
  );
  return findContentPlan(input.accountId, id)!;
}

export function archiveContentPlan(accountId: string, id: string): GrowthContentPlan | null {
  ensureGrowthAccountMigration(accountId);
  const result = run(
    "UPDATE content_plans SET status = 'archived' WHERE account_id = ? AND id = ?",
    [accountId, id],
  );
  return result.changes > 0 ? findContentPlan(accountId, id) : null;
}

function contentItemFromRow(row: GrowthContentItemRow): GrowthContentItem {
  return {
    id: row.id,
    accountId: row.account_id,
    repository: row.repository,
    planId: row.plan_id,
    interventionId: row.intervention_id,
    goalIds: parseJson(row.goal_ids, [] as string[]),
    channel: row.channel,
    format: row.format,
    pillar: row.pillar,
    angle: row.angle,
    title: row.title,
    summary: row.summary,
    body: row.body,
    threadPosts: parseJson(row.thread_posts, [] as string[]),
    media: parseJson(row.media, [] as GrowthContentMedia[]),
    sources: parseJson(row.sources, [] as string[]),
    status: row.status,
    scheduledFor: row.scheduled_for,
    publishedAt: row.published_at,
    publishedUrl: row.published_url,
    generatedAt: row.generated_at,
    generationVersion: row.generation_version,
    evergreen: row.evergreen === 1 ? 1 : 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getContentItem(accountId: string, id: string): GrowthContentItem | null {
  ensureGrowthAccountMigration(accountId);
  const row = get<GrowthContentItemRow>(
    "SELECT * FROM content_items WHERE account_id = ? AND id = ?",
    [accountId, id],
  );
  return row ? contentItemFromRow(row) : null;
}

export function listContentItems(
  accountId: string,
  filters: GrowthContentItemFilters = {},
): GrowthContentItem[] {
  ensureGrowthAccountMigration(accountId);
  const clauses = ["account_id = ?"];
  const params: unknown[] = [accountId];
  if (filters.repository !== undefined) {
    clauses.push("repository = ?");
    params.push(filters.repository);
  }
  if (filters.status !== undefined) {
    clauses.push("status = ?");
    params.push(filters.status);
  }
  if (filters.scheduledFrom !== undefined) {
    clauses.push("scheduled_for >= ?");
    params.push(filters.scheduledFrom);
  }
  if (filters.scheduledTo !== undefined) {
    clauses.push("scheduled_for <= ?");
    params.push(filters.scheduledTo);
  }
  return all<GrowthContentItemRow>(
    `SELECT * FROM content_items WHERE ${clauses.join(" AND ")}
     ORDER BY scheduled_for IS NULL, scheduled_for, created_at, id`,
    params,
  ).map(contentItemFromRow);
}

function isValidIsoDateTime(value: string | null): value is string {
  return value !== null
    && /^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && !Number.isNaN(Date.parse(value));
}

function validatePublishedUrl(value: string | null): void {
  if (value === null) return;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new InvalidPublishedUrlError();
  } catch (error) {
    if (error instanceof InvalidPublishedUrlError) throw error;
    throw new InvalidPublishedUrlError();
  }
}

function validateContentItem(item: GrowthContentItem): void {
  if (MEDIA_REQUIRED_STATUSES.has(item.status) && item.media.length === 0) {
    throw new MediaRequiredError();
  }
  if (item.status === "scheduled" && !isValidIsoDateTime(item.scheduledFor)) {
    throw new ScheduleRequiredError();
  }
  validatePublishedUrl(item.publishedUrl);
}

function assertContentReferences(item: GrowthContentItem): void {
  if (item.planId !== null) {
    const plan = get<{ id: string }>(
      "SELECT id FROM content_plans WHERE account_id = ? AND repository = ? AND id = ?",
      [item.accountId, item.repository, item.planId],
    );
    if (!plan) throw new GrowthStoreValidationError("Content plan does not belong to this account and repository.");
  }
  if (item.interventionId !== null) {
    const intervention = get<{ id: string }>(
      "SELECT id FROM growth_interventions WHERE account_id = ? AND repository = ? AND id = ?",
      [item.accountId, item.repository, item.interventionId],
    );
    if (!intervention) throw new GrowthStoreValidationError("Intervention does not belong to this account and repository.");
  }
}

function insertContentItem(item: GrowthContentItem): void {
  run(
    `INSERT INTO content_items
      (id, account_id, repository, plan_id, intervention_id, goal_ids, channel, format, pillar, angle, title, summary, body,
       thread_posts, media, sources, status, scheduled_for, published_at, published_url, generated_at, generation_version,
       evergreen, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      item.id,
      item.accountId,
      item.repository,
      item.planId,
      item.interventionId,
      JSON.stringify(item.goalIds),
      item.channel,
      item.format,
      item.pillar,
      item.angle,
      item.title,
      item.summary,
      item.body,
      JSON.stringify(item.threadPosts),
      JSON.stringify(item.media),
      JSON.stringify(item.sources),
      item.status,
      item.scheduledFor,
      item.publishedAt,
      item.publishedUrl,
      item.generatedAt,
      item.generationVersion,
      item.evergreen,
      item.createdAt,
      item.updatedAt,
    ],
  );
}

export function createContentItem(input: CreateGrowthContentItemInput): GrowthContentItem {
  ensureGrowthAccountMigration(input.accountId);
  const now = new Date().toISOString();
  const status = input.status ?? "idea";
  const item: GrowthContentItem = {
    id: randomUUID(),
    accountId: input.accountId,
    repository: input.repository,
    planId: input.planId ?? null,
    interventionId: input.interventionId ?? null,
    goalIds: input.goalIds ?? [],
    channel: input.channel,
    format: input.format,
    pillar: input.pillar ?? "",
    angle: input.angle ?? "",
    title: input.title ?? "",
    summary: input.summary ?? "",
    body: input.body ?? "",
    threadPosts: input.threadPosts ?? [],
    media: input.media ?? [],
    sources: input.sources ?? [],
    status,
    scheduledFor: input.scheduledFor ?? null,
    publishedAt: input.publishedAt ?? (status === "published" ? now : null),
    publishedUrl: input.publishedUrl ?? null,
    generatedAt: input.generatedAt ?? null,
    generationVersion: input.generationVersion ?? 1,
    evergreen: input.evergreen ?? 0,
    createdAt: now,
    updatedAt: now,
  };
  validateContentItem(item);
  assertContentReferences(item);
  insertContentItem(item);
  return getContentItem(input.accountId, item.id)!;
}

function persistContentItem(item: GrowthContentItem): void {
  run(
    `UPDATE content_items SET
       plan_id = ?, intervention_id = ?, goal_ids = ?, channel = ?, format = ?, pillar = ?, angle = ?, title = ?, summary = ?,
       body = ?, thread_posts = ?, media = ?, sources = ?, status = ?, scheduled_for = ?, published_at = ?, published_url = ?,
       generated_at = ?, generation_version = ?, evergreen = ?, updated_at = ?
     WHERE account_id = ? AND id = ?`,
    [
      item.planId,
      item.interventionId,
      JSON.stringify(item.goalIds),
      item.channel,
      item.format,
      item.pillar,
      item.angle,
      item.title,
      item.summary,
      item.body,
      JSON.stringify(item.threadPosts),
      JSON.stringify(item.media),
      JSON.stringify(item.sources),
      item.status,
      item.scheduledFor,
      item.publishedAt,
      item.publishedUrl,
      item.generatedAt,
      item.generationVersion,
      item.evergreen,
      item.updatedAt,
      item.accountId,
      item.id,
    ],
  );
}

export function updateContentItem(
  accountId: string,
  id: string,
  updates: UpdateGrowthContentItemInput,
): GrowthContentItem | null {
  ensureGrowthAccountMigration(accountId);
  const current = getContentItem(accountId, id);
  if (!current) return null;
  const item: GrowthContentItem = {
    ...current,
    ...updates,
    updatedAt: new Date().toISOString(),
  };
  if (item.status === "published" && item.publishedAt === null) {
    item.publishedAt = new Date().toISOString();
  }
  validateContentItem(item);
  assertContentReferences(item);
  persistContentItem(item);
  return getContentItem(accountId, id);
}

export function rescheduleContentItem(
  accountId: string,
  id: string,
  scheduledFor: string | null,
): GrowthContentItem | null {
  const current = getContentItem(accountId, id);
  if (!current) return null;
  return updateContentItem(accountId, id, {
    scheduledFor,
    status: scheduledFor === null
      ? (current.status === "scheduled" ? "ready" : current.status)
      : "scheduled",
  });
}

export function markContentItemPublished(
  accountId: string,
  id: string,
  publishedUrl: string | null = null,
): GrowthContentItem | null {
  const normalizedUrl = publishedUrl?.trim() || null;
  validatePublishedUrl(normalizedUrl);
  return updateContentItem(accountId, id, {
    status: "published",
    publishedAt: new Date().toISOString(),
    publishedUrl: normalizedUrl,
  });
}

export function deleteContentItem(accountId: string, id: string): boolean {
  ensureGrowthAccountMigration(accountId);
  return run("DELETE FROM content_items WHERE account_id = ? AND id = ?", [accountId, id]).changes > 0;
}

interface LegacyGoalRow {
  id: string;
  account_id: string;
  repository: string;
  suggestions: string;
  suggestions_generated_at: string | null;
  created_at: string;
  updated_at: string;
}

const LEGACY_MIGRATION_SCOPE = "growth";
const LEGACY_MIGRATION_KEY_PREFIX = "migratedSuggestionsV1:";
const GROWTH_INTERVENTION_CATEGORIES = new Set<GrowthInterventionCategory>([
  "product",
  "community",
  "engineering",
  "marketing",
]);

function isLegacyProposal(value: unknown): value is GoalProposal {
  if (!value || typeof value !== "object") return false;
  const proposal = value as Partial<GoalProposal>;
  return typeof proposal.title === "string"
    && typeof proposal.summary === "string"
    && typeof proposal.content === "string"
    && typeof proposal.format === "string"
    && GOAL_PROPOSAL_FORMATS.includes(proposal.format as GoalProposalFormat);
}

function parseLegacySuggestions(value: string): GoalSuggestion[] {
  const parsed = parseJson<unknown>(value, []);
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const suggestion = entry as Partial<GoalSuggestion>;
    if (
      typeof suggestion.title !== "string"
      || typeof suggestion.action !== "string"
      || !GROWTH_INTERVENTION_CATEGORIES.has(suggestion.category as GrowthInterventionCategory)
    ) return [];
    const proposals = Array.isArray(suggestion.proposals)
      ? suggestion.proposals.filter(isLegacyProposal)
      : undefined;
    return [{
      ...suggestion,
      category: suggestion.category as GrowthInterventionCategory,
      proposals,
    } as GoalSuggestion];
  });
}

function orderedTimestamp(value: string | null, offset: number): string {
  const timestamp = value === null ? Number.NaN : Date.parse(value);
  return new Date((Number.isNaN(timestamp) ? Date.now() : timestamp) + offset).toISOString();
}

function upsertLegacyIntervention(
  accountId: string,
  repository: string,
  goalId: string,
  suggestion: GoalSuggestion,
  createdAt: string,
): string {
  const dedupeKey = createLegacySuggestionDedupeKey(repository, goalId, suggestion.title);
  const existing = get<{ id: string }>(
    `SELECT id FROM growth_interventions
     WHERE account_id = ? AND repository = ? AND goal_id = ? AND dedupe_key = ?
     ORDER BY created_at, id LIMIT 1`,
    [accountId, repository, goalId, dedupeKey],
  );
  if (existing) {
    run(
      `UPDATE growth_interventions
       SET category = ?, title = ?, action = ?, origin = 'ai', rule_key = NULL, dedupe_key = ?, updated_at = ?
       WHERE account_id = ? AND id = ?`,
      [suggestion.category, suggestion.title, suggestion.action, dedupeKey, createdAt, accountId, existing.id],
    );
    return existing.id;
  }

  const id = randomUUID();
  run(
    `INSERT INTO growth_interventions
      (id, account_id, repository, goal_id, category, title, action, origin, rule_key, dedupe_key, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'ai', NULL, ?, 'proposed', ?, ?)`,
    [
      id,
      accountId,
      repository,
      goalId,
      suggestion.category,
      suggestion.title,
      suggestion.action,
      dedupeKey,
      createdAt,
      createdAt,
    ],
  );
  return id;
}

function insertLegacyProposal(
  accountId: string,
  repository: string,
  goalId: string,
  interventionId: string,
  proposal: GoalProposal,
  generatedAt: string,
  generationVersion: number,
  createdAt: string,
): void {
  const item: GrowthContentItem = {
    id: randomUUID(),
    accountId,
    repository,
    planId: null,
    interventionId,
    goalIds: [goalId],
    channel: legacyProposalChannel(proposal.format),
    format: proposal.format,
    pillar: "",
    angle: "",
    title: proposal.title,
    summary: proposal.summary,
    body: proposal.content,
    threadPosts: proposal.threadPosts ?? [],
    media: legacyMediaToContentMedia(proposal.mediaSuggestions),
    sources: [],
    status: "draft",
    scheduledFor: null,
    publishedAt: null,
    publishedUrl: null,
    generatedAt,
    generationVersion,
    evergreen: 0,
    createdAt,
    updatedAt: createdAt,
  };
  validateContentItem(item);
  assertContentReferences(item);
  insertContentItem(item);
}

function migrationKey(accountId: string): string {
  return `${LEGACY_MIGRATION_KEY_PREFIX}${accountId}`;
}

function ensureGrowthAccountMigration(accountId: string): void {
  ensureGrowthSchema();
  migrateLegacySuggestions(accountId);
}

/** Migrates the legacy goal JSON once for one account, including its completion marker. */
export function migrateLegacySuggestions(accountId: string): void {
  ensureGrowthSchema();
  const key = migrationKey(accountId);
  if (getPreference(LEGACY_MIGRATION_SCOPE, key, false)) return;

  const database = getDatabase();
  database.transaction(() => {
    if (getPreference(LEGACY_MIGRATION_SCOPE, key, false)) return;
    const goalsTable = get<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'repository_goals'",
    );
    const goals = goalsTable
      ? all<LegacyGoalRow>(
        `SELECT id, account_id, repository, suggestions, suggestions_generated_at, created_at, updated_at
         FROM repository_goals WHERE account_id = ? ORDER BY deadline, created_at`,
        [accountId],
      )
      : [];

    for (const goal of goals) {
      const suggestions = parseLegacySuggestions(goal.suggestions);
      suggestions.forEach((suggestion, suggestionIndex) => {
        const interventionCreatedAt = orderedTimestamp(
          goal.suggestions_generated_at ?? goal.updated_at ?? goal.created_at,
          suggestionIndex,
        );
        const interventionId = upsertLegacyIntervention(
          accountId,
          goal.repository,
          goal.id,
          suggestion,
          interventionCreatedAt,
        );
        const generatedAt = suggestion.proposalsGeneratedAt
          ?? goal.suggestions_generated_at
          ?? interventionCreatedAt;
        const generationVersion = suggestion.proposalsVersion ?? 1;
        suggestion.proposals?.forEach((proposal, proposalIndex) => {
          insertLegacyProposal(
            accountId,
            goal.repository,
            goal.id,
            interventionId,
            proposal,
            generatedAt,
            generationVersion,
            orderedTimestamp(interventionCreatedAt, proposalIndex),
          );
        });
      });
    }

    setPreference(LEGACY_MIGRATION_SCOPE, key, true);
  })();
}

function contentItemToLegacyProposal(item: GrowthContentItem): GoalProposal {
  const mediaSuggestions = item.media.flatMap((media) => media.url ? [{
    kind: media.kind,
    title: media.alt,
    sourceUrl: media.url,
    guidance: media.caption ?? "",
  }] : []);
  return {
    title: item.title,
    format: item.format,
    summary: item.summary,
    content: item.body,
    ...(item.threadPosts.length > 0 ? { threadPosts: item.threadPosts } : {}),
    ...(mediaSuggestions.length > 0 ? { mediaSuggestions } : {}),
  };
}

/** Projects first-class Growth Studio rows into the temporary Missions API shape. */
export function projectLegacyGoalSuggestions(accountId: string, goalId: string): GoalSuggestion[] {
  migrateLegacySuggestions(accountId);
  return listGrowthInterventions(accountId, { goalId }).map((intervention) => {
    const items = all<GrowthContentItemRow>(
      `SELECT * FROM content_items
       WHERE account_id = ? AND intervention_id = ?
       ORDER BY created_at, id`,
      [accountId, intervention.id],
    ).map(contentItemFromRow);
    return {
      title: intervention.title,
      action: intervention.action,
      category: intervention.category,
      ...(items.length > 0 ? {
        proposals: items.map(contentItemToLegacyProposal),
        proposalsGeneratedAt: items[0].generatedAt,
        proposalsVersion: items[0].generationVersion,
      } : {}),
    };
  });
}

export function saveLegacyGoalSuggestions(
  accountId: string,
  repository: string,
  goalId: string,
  suggestions: GoalSuggestion[],
): void {
  migrateLegacySuggestions(accountId);
  const baseTimestamp = new Date().toISOString();
  getDatabase().transaction(() => {
    suggestions.forEach((suggestion, index) => {
      upsertLegacyIntervention(
        accountId,
        repository,
        goalId,
        suggestion,
        orderedTimestamp(baseTimestamp, index),
      );
    });
  })();
}

export function saveLegacyGoalProposals(
  accountId: string,
  goalId: string,
  suggestionIndex: number,
  proposals: GoalProposal[],
  proposalsVersion: number,
): GoalSuggestion | null {
  migrateLegacySuggestions(accountId);
  const intervention = listGrowthInterventions(accountId, { goalId })[suggestionIndex];
  if (!intervention) return null;
  const generatedAt = new Date().toISOString();
  getDatabase().transaction(() => {
    run(
      `DELETE FROM content_items
       WHERE account_id = ? AND intervention_id = ? AND status IN ('idea', 'draft')`,
      [accountId, intervention.id],
    );
    proposals.forEach((proposal, index) => {
      insertLegacyProposal(
        accountId,
        intervention.repository,
        goalId,
        intervention.id,
        proposal,
        generatedAt,
        proposalsVersion,
        orderedTimestamp(generatedAt, index),
      );
    });
  })();
  return projectLegacyGoalSuggestions(accountId, goalId)[suggestionIndex] ?? null;
}

/** Removes optional goal links while preserving Growth Studio work. */
export function detachGoalFromGrowth(accountId: string, goalId: string): void {
  ensureGrowthAccountMigration(accountId);
  const rows = all<{ id: string; goal_ids: string }>(
    "SELECT id, goal_ids FROM content_items WHERE account_id = ?",
    [accountId],
  );
  for (const row of rows) {
    const goalIds = parseJson(row.goal_ids, [] as string[]);
    if (!goalIds.includes(goalId)) continue;
    run(
      "UPDATE content_items SET goal_ids = ?, updated_at = ? WHERE account_id = ? AND id = ?",
      [JSON.stringify(goalIds.filter((id) => id !== goalId)), new Date().toISOString(), accountId, row.id],
    );
  }
  run(
    "UPDATE growth_interventions SET goal_id = NULL, updated_at = ? WHERE account_id = ? AND goal_id = ?",
    [new Date().toISOString(), accountId, goalId],
  );
}
