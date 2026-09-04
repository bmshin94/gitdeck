import { getActive as getActiveAccount } from "../accountStore";
import { isAiConfigured } from "../ai/settings";
import { findGoal, listGoalRepositories } from "../goalStore";
import { generateRepositoryInterventionSuggestions, refreshGoal } from "../goals";
import {
  createContentItem,
  deleteContentItem,
  getContentItem,
  getGrowthIntervention,
  getGrowthProfile,
  getGrowthWorkspaceSummary,
  GrowthStoreValidationError,
  listContentItems,
  listGrowthInterventions,
  listPersistedGrowthProfileRepositories,
  markContentItemPublished,
  updateContentItem,
  updateGrowthIntervention,
  upsertGrowthIntervention,
  upsertGrowthProfile,
} from "../growth/store";
import { parseJsonBody, sendJson } from "../http";
import type { AppRouter, RouteContext } from "../router";
import {
  GROWTH_CHANNELS,
  GROWTH_CONTENT_ITEM_STATUSES,
  GROWTH_INTERVENTION_STATUSES,
  type GrowthContentChannel,
  type GrowthContentMedia,
  type GrowthContentItemStatus,
  type GrowthInterventionCategory,
  type GrowthInterventionStatus,
  type UpdateGrowthContentItemInput,
  type UpdateGrowthInterventionInput,
} from "../../types/growth";
import { GOAL_PROPOSAL_FORMATS, type GoalProposalFormat } from "../../types/goals";
import { createGrowthInterventionDedupeKey } from "../../utils/growth/interventions";
import {
  GrowthProfileValidationError,
  normalizeGrowthProfileInput,
} from "../../utils/growth/profileValidation";
import { parseRepositoryName } from "../../utils/repository";

const INTERVENTION_CATEGORIES = ["product", "community", "engineering", "marketing"] as const;
const CONTENT_CHANNELS = [...GROWTH_CHANNELS, "other"] as const;
const CONTENT_CREATE_FIELDS = [
  "repository",
  "planId",
  "interventionId",
  "goalIds",
  "channel",
  "format",
  "pillar",
  "angle",
  "title",
  "summary",
  "body",
  "threadPosts",
  "media",
  "sources",
  "status",
  "scheduledFor",
  "generatedAt",
  "generationVersion",
  "evergreen",
] as const;
const CONTENT_UPDATE_FIELDS = CONTENT_CREATE_FIELDS.filter((field) => field !== "repository");

type ActiveAccount = NonNullable<Awaited<ReturnType<typeof getActiveAccount>>>;

async function requireAccount(ctx: RouteContext): Promise<ActiveAccount | null> {
  const account = await getActiveAccount();
  if (!account) {
    sendJson(ctx.res, 401, { ok: false, needsAuth: true, error: "authentication required" });
  }
  return account;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function badRequest(ctx: RouteContext, error: string): void {
  sendJson(ctx.res, 400, { ok: false, error });
}

function decodeRepositoryParams(ctx: RouteContext): string | null {
  try {
    const owner = decodeURIComponent(ctx.params.owner ?? "");
    const repo = decodeURIComponent(ctx.params.repo ?? "");
    const repository = `${owner}/${repo}`;
    if (!parseRepositoryName(repository)) throw new Error("invalid repository");
    return repository;
  } catch {
    badRequest(ctx, "invalid repository");
    return null;
  }
}

function repositoryFromValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const repository = value.trim();
  return parseRepositoryName(repository) ? repository : null;
}

function isEnumValue<Value extends string>(values: readonly Value[], value: unknown): value is Value {
  return typeof value === "string" && values.includes(value as Value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isIsoDateTime(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(value) && !Number.isNaN(Date.parse(value));
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function parseOptionalId(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string" || value.trim().length === 0) return undefined;
  return value.trim();
}

function goalBelongsToRepository(accountId: string, goalId: string, repository: string): boolean {
  return findGoal(accountId, goalId)?.repository === repository;
}

function sendStoreError(ctx: RouteContext, error: unknown): boolean {
  if (error instanceof GrowthStoreValidationError || error instanceof GrowthProfileValidationError) {
    badRequest(ctx, error.message);
    return true;
  }
  return false;
}

async function listWorkspaces(ctx: RouteContext): Promise<void> {
  const account = await requireAccount(ctx);
  if (!account) return;
  const repositories = new Set([
    ...listPersistedGrowthProfileRepositories(account.id),
    ...listGoalRepositories(account.id),
  ]);
  const workspaces = [...repositories]
    .sort((left, right) => left.localeCompare(right, "en", { sensitivity: "base" }))
    .map((repository) => getGrowthWorkspaceSummary(account.id, repository));
  sendJson(ctx.res, 200, { ok: true, workspaces });
}

async function readWorkspace(ctx: RouteContext): Promise<void> {
  const account = await requireAccount(ctx);
  if (!account) return;
  const repository = decodeRepositoryParams(ctx);
  if (!repository) return;
  sendJson(ctx.res, 200, { ok: true, workspace: getGrowthWorkspaceSummary(account.id, repository) });
}

async function profile(ctx: RouteContext): Promise<void> {
  const account = await requireAccount(ctx);
  if (!account) return;
  const repository = decodeRepositoryParams(ctx);
  if (!repository) return;
  if (ctx.req.method === "GET") {
    return sendJson(ctx.res, 200, { ok: true, profile: getGrowthProfile(account.id, repository) });
  }
  const body = await parseJsonBody<Record<string, unknown>>(ctx.req, ctx.res);
  if (!body) return;
  try {
    const saved = upsertGrowthProfile(account.id, repository, normalizeGrowthProfileInput(body));
    sendJson(ctx.res, 200, { ok: true, profile: saved });
  } catch (error) {
    if (!sendStoreError(ctx, error)) throw error;
  }
}

function parseInterventionFilters(ctx: RouteContext): { repository?: string; status?: GrowthInterventionStatus; goalId?: string | null } | null {
  const allowed = new Set(["repo", "status", "goalId"]);
  if ([...ctx.url.searchParams.keys()].some((key) => !allowed.has(key))) {
    badRequest(ctx, "unknown intervention filter");
    return null;
  }
  const repositoryValue = ctx.url.searchParams.get("repo");
  const repository = repositoryValue === null ? undefined : repositoryFromValue(repositoryValue);
  if (repositoryValue !== null && !repository) {
    badRequest(ctx, "invalid repository");
    return null;
  }
  const statusValue = ctx.url.searchParams.get("status");
  if (statusValue !== null && !isEnumValue(GROWTH_INTERVENTION_STATUSES, statusValue)) {
    badRequest(ctx, "invalid intervention status");
    return null;
  }
  const filters: { repository?: string; status?: GrowthInterventionStatus; goalId?: string | null } = {
    repository: repository ?? undefined,
    status: statusValue ?? undefined,
  };
  if (ctx.url.searchParams.has("goalId")) filters.goalId = ctx.url.searchParams.get("goalId") || null;
  return filters;
}

async function interventions(ctx: RouteContext): Promise<void> {
  const account = await requireAccount(ctx);
  if (!account) return;
  if (ctx.req.method === "GET") {
    const filters = parseInterventionFilters(ctx);
    if (!filters) return;
    return sendJson(ctx.res, 200, {
      ok: true,
      interventions: listGrowthInterventions(account.id, filters),
    });
  }

  const body = await parseJsonBody<Record<string, unknown>>(ctx.req, ctx.res);
  if (!body) return;
  const allowed = ["repository", "goalId", "category", "title", "action"];
  if (!isRecord(body) || !hasOnlyKeys(body, allowed)) return badRequest(ctx, "invalid intervention body");
  const repository = repositoryFromValue(body.repository);
  const goalId = parseOptionalId(body.goalId);
  if (!repository) return badRequest(ctx, "invalid repository");
  if (body.goalId !== undefined && goalId === undefined) return badRequest(ctx, "invalid goalId");
  if (goalId && !goalBelongsToRepository(account.id, goalId, repository)) return badRequest(ctx, "invalid goalId");
  if (!isEnumValue(INTERVENTION_CATEGORIES, body.category)) return badRequest(ctx, "invalid intervention category");
  if (typeof body.title !== "string" || !body.title.trim()) return badRequest(ctx, "title must not be empty");
  if (typeof body.action !== "string" || !body.action.trim()) return badRequest(ctx, "action must not be empty");
  const title = body.title.trim();
  const intervention = upsertGrowthIntervention({
    accountId: account.id,
    repository,
    goalId: goalId ?? null,
    category: body.category,
    title,
    action: body.action.trim(),
    origin: "manual",
    dedupeKey: createGrowthInterventionDedupeKey(repository, goalId ?? null, body.category, title),
  });
  sendJson(ctx.res, 201, { ok: true, intervention });
}

async function generateInterventions(ctx: RouteContext): Promise<void> {
  const account = await requireAccount(ctx);
  if (!account) return;
  const body = await parseJsonBody<Record<string, unknown>>(ctx.req, ctx.res);
  if (!body) return;
  if (!isRecord(body) || !hasOnlyKeys(body, ["repository", "goalId"])) {
    return badRequest(ctx, "invalid intervention generation body");
  }
  const repository = repositoryFromValue(body.repository);
  const goalId = parseOptionalId(body.goalId);
  if (!repository) return badRequest(ctx, "invalid repository");
  if (body.goalId !== undefined && (goalId === undefined || goalId === null)) return badRequest(ctx, "invalid goalId");
  const storedGoal = goalId ? findGoal(account.id, goalId) : null;
  if (goalId && !storedGoal) return sendJson(ctx.res, 404, { ok: false, error: "goal not found" });
  if (storedGoal && storedGoal.repository !== repository) return badRequest(ctx, "invalid goalId");

  try {
    const goal = storedGoal ? await refreshGoal(storedGoal) : undefined;
    const suggestions = await generateRepositoryInterventionSuggestions(account.id, repository, goal);
    const generated = suggestions.map((suggestion) => upsertGrowthIntervention({
      accountId: account.id,
      repository,
      goalId: goalId ?? null,
      category: suggestion.category,
      title: suggestion.title.trim(),
      action: suggestion.action.trim(),
      origin: "ai",
      dedupeKey: createGrowthInterventionDedupeKey(
        repository,
        goalId ?? null,
        suggestion.category,
        suggestion.title,
      ),
    }));
    sendJson(ctx.res, 200, {
      ok: true,
      interventions: generated,
      aiEnabled: isAiConfigured(),
    });
  } catch (error) {
    sendJson(ctx.res, 502, { ok: false, error: (error as Error).message });
  }
}

async function patchIntervention(ctx: RouteContext): Promise<void> {
  const account = await requireAccount(ctx);
  if (!account) return;
  const current = getGrowthIntervention(account.id, ctx.params.id ?? "");
  if (!current) return sendJson(ctx.res, 404, { ok: false, error: "intervention not found" });
  const body = await parseJsonBody<Record<string, unknown>>(ctx.req, ctx.res);
  if (!body) return;
  const allowed = ["goalId", "category", "title", "action", "status"];
  if (!isRecord(body) || Object.keys(body).length === 0 || !hasOnlyKeys(body, allowed)) {
    return badRequest(ctx, "invalid intervention patch");
  }
  const updates: UpdateGrowthInterventionInput = {};
  if (body.goalId !== undefined) {
    const goalId = parseOptionalId(body.goalId);
    if (goalId === undefined) return badRequest(ctx, "invalid goalId");
    if (goalId && !goalBelongsToRepository(account.id, goalId, current.repository)) return badRequest(ctx, "invalid goalId");
    updates.goalId = goalId;
  }
  if (body.category !== undefined) {
    if (!isEnumValue(INTERVENTION_CATEGORIES, body.category)) return badRequest(ctx, "invalid intervention category");
    updates.category = body.category;
  }
  for (const field of ["title", "action"] as const) {
    if (body[field] !== undefined) {
      if (typeof body[field] !== "string" || !body[field].trim()) return badRequest(ctx, `${field} must not be empty`);
      updates[field] = body[field].trim();
    }
  }
  if (body.status !== undefined) {
    if (!isEnumValue(GROWTH_INTERVENTION_STATUSES, body.status)) return badRequest(ctx, "invalid intervention status");
    updates.status = body.status;
  }
  if (updates.title !== undefined || updates.goalId !== undefined || updates.category !== undefined) {
    updates.dedupeKey = createGrowthInterventionDedupeKey(
      current.repository,
      updates.goalId ?? current.goalId,
      updates.category ?? current.category,
      updates.title ?? current.title,
    );
  }
  sendJson(ctx.res, 200, {
    ok: true,
    intervention: updateGrowthIntervention(account.id, current.id, updates),
  });
}

function normalizeMedia(value: unknown): GrowthContentMedia[] | null {
  if (!Array.isArray(value)) return null;
  const result: GrowthContentMedia[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || !hasOnlyKeys(entry, ["assetId", "url", "kind", "alt", "caption"])) return null;
    if (entry.kind !== "image" && entry.kind !== "video") return null;
    if (typeof entry.alt !== "string" || !entry.alt.trim()) return null;
    const assetId = parseOptionalId(entry.assetId);
    if (entry.assetId !== undefined && (assetId === undefined || assetId === null)) return null;
    if (entry.url !== undefined && (typeof entry.url !== "string" || !isHttpUrl(entry.url.trim()))) return null;
    if (entry.caption !== undefined && typeof entry.caption !== "string") return null;
    if (!assetId && entry.url === undefined) return null;
    result.push({
      kind: entry.kind,
      alt: entry.alt.trim(),
      ...(assetId ? { assetId } : {}),
      ...(typeof entry.url === "string" ? { url: entry.url.trim() } : {}),
      ...(typeof entry.caption === "string" ? { caption: entry.caption.trim() } : {}),
    });
  }
  return result;
}

function parseContentUpdates(body: Record<string, unknown>, creating: boolean): UpdateGrowthContentItemInput | null {
  const allowed = creating ? CONTENT_CREATE_FIELDS : CONTENT_UPDATE_FIELDS;
  if (!hasOnlyKeys(body, allowed)) return null;
  const updates: UpdateGrowthContentItemInput = {};
  if (body.planId !== undefined) {
    const value = parseOptionalId(body.planId);
    if (value === undefined) return null;
    updates.planId = value;
  }
  if (body.interventionId !== undefined) {
    const value = parseOptionalId(body.interventionId);
    if (value === undefined) return null;
    updates.interventionId = value;
  }
  if (body.goalIds !== undefined) {
    if (!Array.isArray(body.goalIds) || body.goalIds.some((id) => typeof id !== "string" || !id.trim())) return null;
    updates.goalIds = [...new Set(body.goalIds.map((id) => (id as string).trim()))];
  }
  if (body.channel !== undefined) {
    if (!isEnumValue(CONTENT_CHANNELS, body.channel)) return null;
    updates.channel = body.channel as GrowthContentChannel;
  }
  if (body.format !== undefined) {
    if (!isEnumValue(GOAL_PROPOSAL_FORMATS, body.format)) return null;
    updates.format = body.format as GoalProposalFormat;
  }
  for (const field of ["pillar", "angle", "title", "summary", "body"] as const) {
    if (body[field] !== undefined) {
      if (typeof body[field] !== "string") return null;
      updates[field] = body[field];
    }
  }
  if (body.threadPosts !== undefined) {
    if (!Array.isArray(body.threadPosts) || body.threadPosts.some((post) => typeof post !== "string")) return null;
    updates.threadPosts = body.threadPosts as string[];
  }
  if (body.media !== undefined) {
    const media = normalizeMedia(body.media);
    if (!media) return null;
    updates.media = media;
  }
  if (body.sources !== undefined) {
    if (!Array.isArray(body.sources) || body.sources.some((source) => typeof source !== "string" || !isHttpUrl(source.trim()))) return null;
    updates.sources = body.sources.map((source) => (source as string).trim());
  }
  if (body.status !== undefined) {
    if (!isEnumValue(GROWTH_CONTENT_ITEM_STATUSES, body.status)) return null;
    updates.status = body.status as GrowthContentItemStatus;
  }
  for (const field of ["scheduledFor", "generatedAt"] as const) {
    if (body[field] !== undefined) {
      if (!isNullableString(body[field]) || (body[field] !== null && !isIsoDateTime(body[field]))) return null;
      updates[field] = body[field];
    }
  }
  if (body.generationVersion !== undefined) {
    if (!Number.isSafeInteger(body.generationVersion) || (body.generationVersion as number) < 1) return null;
    updates.generationVersion = body.generationVersion as number;
  }
  if (body.evergreen !== undefined) {
    if (body.evergreen !== 0 && body.evergreen !== 1) return null;
    updates.evergreen = body.evergreen;
  }
  return updates;
}

function parseContentFilters(ctx: RouteContext): Parameters<typeof listContentItems>[1] | null {
  const allowed = new Set(["repo", "status", "scheduledFrom", "scheduledTo"]);
  if ([...ctx.url.searchParams.keys()].some((key) => !allowed.has(key))) {
    badRequest(ctx, "unknown content filter");
    return null;
  }
  const repositoryValue = ctx.url.searchParams.get("repo");
  const repository = repositoryValue === null ? undefined : repositoryFromValue(repositoryValue);
  if (repositoryValue !== null && !repository) {
    badRequest(ctx, "invalid repository");
    return null;
  }
  const statusValue = ctx.url.searchParams.get("status");
  if (statusValue !== null && !isEnumValue(GROWTH_CONTENT_ITEM_STATUSES, statusValue)) {
    badRequest(ctx, "invalid content status");
    return null;
  }
  const scheduledFrom = ctx.url.searchParams.get("scheduledFrom") ?? undefined;
  const scheduledTo = ctx.url.searchParams.get("scheduledTo") ?? undefined;
  if ((scheduledFrom && !isIsoDateTime(scheduledFrom)) || (scheduledTo && !isIsoDateTime(scheduledTo))) {
    badRequest(ctx, "invalid scheduled date range");
    return null;
  }
  return { repository: repository ?? undefined, status: statusValue ?? undefined, scheduledFrom, scheduledTo };
}

async function content(ctx: RouteContext): Promise<void> {
  const account = await requireAccount(ctx);
  if (!account) return;
  if (ctx.req.method === "GET") {
    const filters = parseContentFilters(ctx);
    if (!filters) return;
    return sendJson(ctx.res, 200, { ok: true, contentItems: listContentItems(account.id, filters) });
  }

  const body = await parseJsonBody<Record<string, unknown>>(ctx.req, ctx.res);
  if (!body) return;
  const repository = repositoryFromValue(body.repository);
  const updates = isRecord(body) ? parseContentUpdates(body, true) : null;
  if (!repository || !updates || !isEnumValue(CONTENT_CHANNELS, body.channel) || !isEnumValue(GOAL_PROPOSAL_FORMATS, body.format)) {
    return badRequest(ctx, "invalid content body");
  }
  if (updates.goalIds?.some((goalId) => !goalBelongsToRepository(account.id, goalId, repository))) {
    return badRequest(ctx, "invalid goalIds");
  }
  try {
    const contentItem = createContentItem({
      accountId: account.id,
      repository,
      channel: body.channel,
      format: body.format,
      ...updates,
    });
    sendJson(ctx.res, 201, { ok: true, contentItem });
  } catch (error) {
    if (!sendStoreError(ctx, error)) throw error;
  }
}

async function patchContent(ctx: RouteContext): Promise<void> {
  const account = await requireAccount(ctx);
  if (!account) return;
  const current = getContentItem(account.id, ctx.params.id ?? "");
  if (!current) return sendJson(ctx.res, 404, { ok: false, error: "content item not found" });
  const body = await parseJsonBody<Record<string, unknown>>(ctx.req, ctx.res);
  if (!body) return;
  const updates = isRecord(body) && Object.keys(body).length > 0 ? parseContentUpdates(body, false) : null;
  if (!updates) return badRequest(ctx, "invalid content patch");
  if (updates.goalIds?.some((goalId) => !goalBelongsToRepository(account.id, goalId, current.repository))) {
    return badRequest(ctx, "invalid goalIds");
  }
  if (Object.prototype.hasOwnProperty.call(updates, "scheduledFor") && updates.status === undefined) {
    updates.status = updates.scheduledFor === null
      ? (current.status === "scheduled" ? "ready" : current.status)
      : "scheduled";
  }
  try {
    const contentItem = updateContentItem(account.id, current.id, updates);
    sendJson(ctx.res, 200, { ok: true, contentItem });
  } catch (error) {
    if (!sendStoreError(ctx, error)) throw error;
  }
}

async function publishContent(ctx: RouteContext): Promise<void> {
  const account = await requireAccount(ctx);
  if (!account) return;
  if (!getContentItem(account.id, ctx.params.id ?? "")) {
    return sendJson(ctx.res, 404, { ok: false, error: "content item not found" });
  }
  const body = await parseJsonBody<Record<string, unknown>>(ctx.req, ctx.res);
  if (!body) return;
  if (!isRecord(body) || !hasOnlyKeys(body, ["url"]) || (body.url !== undefined && !isNullableString(body.url))) {
    return badRequest(ctx, "invalid published body");
  }
  try {
    const contentItem = markContentItemPublished(account.id, ctx.params.id ?? "", body.url ?? null);
    sendJson(ctx.res, 200, { ok: true, contentItem });
  } catch (error) {
    if (!sendStoreError(ctx, error)) throw error;
  }
}

async function removeContent(ctx: RouteContext): Promise<void> {
  const account = await requireAccount(ctx);
  if (!account) return;
  if (!deleteContentItem(account.id, ctx.params.id ?? "")) {
    return sendJson(ctx.res, 404, { ok: false, error: "content item not found" });
  }
  sendJson(ctx.res, 200, { ok: true });
}

export function registerGrowthRoutes(router: AppRouter): void {
  router.get("/api/growth/workspaces", listWorkspaces);
  router.get("/api/growth/workspace/:owner/:repo", readWorkspace);
  router.get("/api/growth/profiles/:owner/:repo", profile);
  router.on("PUT", "/api/growth/profiles/:owner/:repo", profile);
  router.get("/api/growth/interventions", interventions);
  router.post("/api/growth/interventions", interventions);
  router.post("/api/growth/interventions/generate", generateInterventions);
  router.on("PATCH", "/api/growth/interventions/:id", patchIntervention);
  router.get("/api/growth/content", content);
  router.post("/api/growth/content", content);
  router.on("PATCH", "/api/growth/content/:id", patchContent);
  router.post("/api/growth/content/:id/published", publishContent);
  router.delete("/api/growth/content/:id", removeContent);
}
