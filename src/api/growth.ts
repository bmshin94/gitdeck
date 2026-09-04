import { AuthRequiredClientError } from "./github";
import type {
  CreateGrowthContentItemInput,
  GenerateGrowthContentPlanInput,
  GrowthArchivedContentPlanData,
  GrowthAssetData,
  GrowthAssetImportCandidatesData,
  GrowthAssetsData,
  GrowthContentItemData,
  GrowthContentItemFilters,
  GrowthContentItemsData,
  GrowthContentPlansData,
  GrowthDraftContentData,
  GrowthDraftContentItemData,
  GrowthGeneratedContentPlanData,
  GrowthGeneratedInterventionsData,
  GrowthInterventionData,
  GrowthInterventionFilters,
  GrowthInterventionsData,
  GrowthInterventionCategory,
  GrowthImportedAssetData,
  ImportGrowthAssetInput,
  GrowthProfileData,
  GrowthProfileInput,
  GrowthRegeneratedContentPlanData,
  GrowthWorkspaceData,
  GrowthWorkspacesData,
  GrowthWorkspaceSummary,
  UpdateGrowthContentItemInput,
  UpdateGrowthInterventionInput,
  UploadGrowthAssetInput,
} from "../types/growth";
import { parseRepositoryName } from "../utils/repository";

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const body = await response.json() as T & { ok?: boolean; needsAuth?: boolean; error?: string };
  if (response.status === 401 || body.needsAuth) {
    throw new AuthRequiredClientError(body.error || "authentication required");
  }
  if (!response.ok || body.ok === false) {
    throw new Error(body.error || `Request failed: ${response.status}`);
  }
  return body;
}

function jsonRequest(method: "POST" | "PUT" | "PATCH", body: unknown, signal?: AbortSignal): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  };
}

function repositoryRoute(repository: string): string {
  const parts = parseRepositoryName(repository);
  if (!parts) throw new Error("invalid repository");
  return `${encodeURIComponent(parts[0])}/${encodeURIComponent(parts[1])}`;
}

export async function fetchGrowthWorkspaces(signal?: AbortSignal): Promise<GrowthWorkspaceSummary[]> {
  const data = await requestJson<GrowthWorkspacesData>("/api/growth/workspaces", { signal });
  return data.workspaces;
}

export async function fetchGrowthWorkspaceSummary(
  repository: string,
  signal?: AbortSignal,
): Promise<GrowthWorkspaceSummary> {
  const data = await requestJson<GrowthWorkspaceData>(
    `/api/growth/workspace/${repositoryRoute(repository)}`,
    { signal },
  );
  return data.workspace;
}

export async function fetchGrowthProfile(repository: string, signal?: AbortSignal) {
  const data = await requestJson<GrowthProfileData>(
    `/api/growth/profiles/${repositoryRoute(repository)}`,
    { signal },
  );
  return data.profile;
}

export async function updateGrowthProfile(repository: string, profile: GrowthProfileInput) {
  const data = await requestJson<GrowthProfileData>(
    `/api/growth/profiles/${repositoryRoute(repository)}`,
    jsonRequest("PUT", profile),
  );
  return data.profile;
}

function addFilters(path: string, filters: Record<string, string | null | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null) query.set(key, value);
  }
  const serialized = query.toString();
  return serialized ? `${path}?${serialized}` : path;
}

export function buildGrowthAssetFileUrl(id: string): string {
  const normalized = id.trim();
  if (!normalized) throw new Error("invalid asset ID");
  return `/api/growth/assets/${encodeURIComponent(normalized)}/file`;
}

export async function fetchGrowthAssets(repository: string, signal?: AbortSignal) {
  if (!parseRepositoryName(repository)) throw new Error("invalid repository");
  const data = await requestJson<GrowthAssetsData>(addFilters("/api/growth/assets", {
    repo: repository,
  }), { signal });
  return data.assets;
}

export async function fetchGrowthAssetImportCandidates(repository: string, signal?: AbortSignal) {
  if (!parseRepositoryName(repository)) throw new Error("invalid repository");
  const data = await requestJson<GrowthAssetImportCandidatesData>(addFilters(
    "/api/growth/assets/import-candidates",
    { repo: repository },
  ), { signal });
  return data.candidates;
}

export async function importGrowthAsset(input: ImportGrowthAssetInput, signal?: AbortSignal) {
  if (!parseRepositoryName(input.repository)) throw new Error("invalid repository");
  return requestJson<GrowthImportedAssetData>(
    "/api/growth/assets/import",
    jsonRequest("POST", input, signal),
  );
}

export async function uploadGrowthAsset(input: UploadGrowthAssetInput, signal?: AbortSignal) {
  if (!parseRepositoryName(input.repository)) throw new Error("invalid repository");
  const query = new URLSearchParams({
    repo: input.repository,
    filename: input.filename,
    title: input.title,
    alt: input.alt,
  });
  if (input.width !== undefined) query.set("width", String(input.width));
  if (input.height !== undefined) query.set("height", String(input.height));
  const data = await requestJson<GrowthAssetData>(`/api/growth/assets?${query.toString()}`, {
    method: "POST",
    headers: { "Content-Type": input.file.type },
    body: input.file,
    signal,
  });
  return data.asset;
}

export async function fetchGrowthAssetFile(id: string, signal?: AbortSignal): Promise<Blob> {
  const response = await fetch(buildGrowthAssetFileUrl(id), { cache: "no-store", signal });
  if (!response.ok) {
    let body: { needsAuth?: boolean; error?: string } = {};
    try {
      body = await response.json() as typeof body;
    } catch {
      // Preserve the HTTP fallback when an intermediary returns a non-JSON error.
    }
    if (response.status === 401 || body.needsAuth) {
      throw new AuthRequiredClientError(body.error || "authentication required");
    }
    throw new Error(body.error || `Request failed: ${response.status}`);
  }
  return response.blob();
}

export function buildGrowthCalendarExportUrl(filters: {
  repository?: string;
  from?: string;
  to?: string;
} = {}): string {
  if (filters.repository !== undefined && !parseRepositoryName(filters.repository)) {
    throw new Error("invalid repository");
  }
  return addFilters("/api/growth/calendar.ics", {
    repo: filters.repository,
    from: filters.from,
    to: filters.to,
  });
}

export async function fetchGrowthInterventions(
  filters: GrowthInterventionFilters = {},
  signal?: AbortSignal,
) {
  const data = await requestJson<GrowthInterventionsData>(addFilters("/api/growth/interventions", {
    repo: filters.repository,
    goalId: filters.goalId === null ? "" : filters.goalId,
    status: filters.status,
  }), { signal });
  return data.interventions;
}

export async function createGrowthIntervention(input: {
  repository: string;
  goalId?: string | null;
  category: GrowthInterventionCategory;
  title: string;
  action: string;
}) {
  const data = await requestJson<GrowthInterventionData>(
    "/api/growth/interventions",
    jsonRequest("POST", input),
  );
  return data.intervention;
}

export async function patchGrowthIntervention(id: string, updates: Omit<UpdateGrowthInterventionInput, "dedupeKey">) {
  const data = await requestJson<GrowthInterventionData>(
    `/api/growth/interventions/${encodeURIComponent(id)}`,
    jsonRequest("PATCH", updates),
  );
  return data.intervention;
}

export async function generateGrowthInterventions(repository: string, goalId?: string) {
  return requestJson<GrowthGeneratedInterventionsData>(
    "/api/growth/interventions/generate",
    jsonRequest("POST", { repository, ...(goalId ? { goalId } : {}) }),
  );
}

type GrowthContentCreateRequest = Omit<
  CreateGrowthContentItemInput,
  "accountId" | "publishedAt" | "publishedUrl"
>;
type GrowthContentUpdateRequest = Omit<
  UpdateGrowthContentItemInput,
  "publishedAt" | "publishedUrl"
>;

export async function draftGrowthContentFromIntervention(interventionId: string, refresh = false) {
  const data = await requestJson<GrowthDraftContentData>(
    "/api/growth/content/draft",
    jsonRequest("POST", { interventionId, refresh }),
  );
  return data;
}

export async function draftGrowthContentItem(id: string, refresh = false, signal?: AbortSignal) {
  return requestJson<GrowthDraftContentItemData>(
    `/api/growth/content/${encodeURIComponent(id)}/draft`,
    jsonRequest("POST", refresh ? { refresh: true } : {}, signal),
  );
}

export async function fetchGrowthContentPlans(repository: string, signal?: AbortSignal) {
  const data = await requestJson<GrowthContentPlansData>(addFilters("/api/growth/plans", {
    repo: repository,
  }), { signal });
  return data.plans;
}

export async function generateGrowthContentPlan(
  input: GenerateGrowthContentPlanInput,
  signal?: AbortSignal,
): Promise<GrowthGeneratedContentPlanData> {
  return requestJson<GrowthGeneratedContentPlanData>(
    "/api/growth/plans/generate",
    jsonRequest("POST", input, signal),
  );
}

export async function regenerateGrowthContentPlan(id: string, signal?: AbortSignal) {
  return requestJson<GrowthRegeneratedContentPlanData>(
    `/api/growth/plans/${encodeURIComponent(id)}/regenerate`,
    jsonRequest("POST", {}, signal),
  );
}

export async function archiveGrowthContentPlan(id: string, signal?: AbortSignal) {
  return requestJson<GrowthArchivedContentPlanData>(
    `/api/growth/plans/${encodeURIComponent(id)}/archive`,
    jsonRequest("POST", {}, signal),
  );
}

export async function fetchGrowthContentItems(
  filters: GrowthContentItemFilters = {},
  signal?: AbortSignal,
) {
  const data = await requestJson<GrowthContentItemsData>(addFilters("/api/growth/content", {
    repo: filters.repository,
    status: filters.status,
    scheduledFrom: filters.scheduledFrom,
    scheduledTo: filters.scheduledTo,
  }), { signal });
  return data.contentItems;
}

export async function createGrowthContentItem(input: GrowthContentCreateRequest) {
  const data = await requestJson<GrowthContentItemData>(
    "/api/growth/content",
    jsonRequest("POST", input),
  );
  return data.contentItem;
}

export async function patchGrowthContentItem(id: string, updates: GrowthContentUpdateRequest) {
  const data = await requestJson<GrowthContentItemData>(
    `/api/growth/content/${encodeURIComponent(id)}`,
    jsonRequest("PATCH", updates),
  );
  return data.contentItem;
}

export async function markGrowthContentPublished(id: string, url?: string | null) {
  const data = await requestJson<GrowthContentItemData>(
    `/api/growth/content/${encodeURIComponent(id)}/published`,
    jsonRequest("POST", { url: url ?? null }),
  );
  return data.contentItem;
}

export async function deleteGrowthContentItem(id: string): Promise<void> {
  await requestJson<{ ok: true }>(`/api/growth/content/${encodeURIComponent(id)}`, { method: "DELETE" });
}
