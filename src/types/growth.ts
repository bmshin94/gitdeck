import type { GoalProposalFormat } from "./goals";

export const GROWTH_CHANNELS = [
  "x",
  "linkedin",
  "mastodon",
  "bluesky",
  "discussion",
  "blog",
] as const;
export type GrowthChannel = (typeof GROWTH_CHANNELS)[number];
export type GrowthContentChannel = GrowthChannel | "other";

export interface GrowthPillar {
  id: string;
  label: string;
  weight: number;
  description: string;
}

export interface GrowthPostingWindow {
  /** ISO weekday, from Monday (1) through Sunday (7). */
  weekday: number;
  /** Local hour in the profile timezone, from 0 through 23. */
  hour: number;
}

export type GrowthChannelSelection = Record<GrowthChannel, boolean>;
export type GrowthCadence = Record<GrowthChannel, number>;

export interface GrowthProfile {
  accountId: string;
  repository: string;
  language: string;
  voice: string;
  audience: string;
  channels: GrowthChannelSelection;
  cadence: GrowthCadence;
  pillars: GrowthPillar[];
  hashtags: string[];
  avoid: string;
  timezone: string;
  postingWindows: GrowthPostingWindow[];
  color: string;
  updatedAt: string;
}

export type GrowthProfileInput = Omit<GrowthProfile, "accountId" | "repository" | "updatedAt">;

export interface GrowthPlanSlot {
  key: string;
  channel: GrowthChannel;
  format: GoalProposalFormat;
  pillarId: string;
  scheduledFor: string;
}

export interface GrowthPlanAssignment {
  slotKey: string;
  pillarId: string;
  angle: string;
  sources: string[];
  cta: string;
}

export interface GrowthPlanEvidence {
  label: string;
  url: string | null;
}

export interface BuildGrowthPlanSlotsInput {
  periodStart: string;
  periodEnd: string;
  channels: GrowthChannelSelection;
  cadence: GrowthCadence;
  pillars: readonly GrowthPillar[];
  postingWindows: readonly GrowthPostingWindow[];
  timezone: string;
}

export const GROWTH_INTERVENTION_STATUSES = ["proposed", "accepted", "dismissed", "done"] as const;
export type GrowthInterventionStatus = (typeof GROWTH_INTERVENTION_STATUSES)[number];
export type GrowthInterventionCategory = "product" | "community" | "engineering" | "marketing";
export type GrowthInterventionOrigin = "ai" | "rule" | "manual";

export interface GrowthIntervention {
  id: string;
  accountId: string;
  repository: string;
  goalId: string | null;
  category: GrowthInterventionCategory;
  title: string;
  action: string;
  origin: GrowthInterventionOrigin;
  ruleKey: string | null;
  dedupeKey: string;
  status: GrowthInterventionStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateGrowthInterventionInput {
  accountId: string;
  repository: string;
  goalId?: string | null;
  category: GrowthInterventionCategory;
  title: string;
  action: string;
  origin: GrowthInterventionOrigin;
  ruleKey?: string | null;
  dedupeKey: string;
  status?: GrowthInterventionStatus;
}

export interface GrowthInterventionFilters {
  repository?: string;
  goalId?: string | null;
  status?: GrowthInterventionStatus;
}

export type UpdateGrowthInterventionInput = Partial<Pick<
  GrowthIntervention,
  "goalId" | "category" | "title" | "action" | "dedupeKey" | "status"
>>;

export type GrowthContentPlanStatus = "draft" | "active" | "archived";

export interface GrowthContentPlan {
  id: string;
  accountId: string;
  repository: string;
  periodStart: string;
  periodEnd: string;
  cadence: GrowthCadence;
  pillars: GrowthPillar[];
  status: GrowthContentPlanStatus;
  generatedAt: string;
  createdAt: string;
}

export interface CreateGrowthContentPlanInput {
  accountId: string;
  repository: string;
  periodStart: string;
  periodEnd: string;
  cadence: GrowthCadence;
  pillars: GrowthPillar[];
  status?: Exclude<GrowthContentPlanStatus, "archived">;
  generatedAt?: string;
}

export interface GenerateGrowthContentPlanInput {
  repository: string;
  periodStart: string;
  periodEnd: string;
}

export const GROWTH_CONTENT_ITEM_STATUSES = [
  "idea",
  "draft",
  "ready",
  "scheduled",
  "published",
  "skipped",
] as const;
export type GrowthContentItemStatus = (typeof GROWTH_CONTENT_ITEM_STATUSES)[number];

export interface GrowthContentMedia {
  assetId?: string;
  url?: string;
  kind: "image" | "video";
  alt: string;
  caption?: string;
}

export interface GrowthContentItem {
  id: string;
  accountId: string;
  repository: string;
  planId: string | null;
  interventionId: string | null;
  goalIds: string[];
  channel: GrowthContentChannel;
  format: GoalProposalFormat;
  pillar: string;
  angle: string;
  title: string;
  summary: string;
  body: string;
  threadPosts: string[];
  media: GrowthContentMedia[];
  sources: string[];
  status: GrowthContentItemStatus;
  scheduledFor: string | null;
  publishedAt: string | null;
  publishedUrl: string | null;
  generatedAt: string | null;
  generationVersion: number;
  evergreen: 0 | 1;
  createdAt: string;
  updatedAt: string;
}

export type CreateGrowthContentItemInput = Pick<
  GrowthContentItem,
  "accountId" | "repository" | "channel" | "format"
> & Partial<Pick<
  GrowthContentItem,
  | "planId"
  | "interventionId"
  | "goalIds"
  | "pillar"
  | "angle"
  | "title"
  | "summary"
  | "body"
  | "threadPosts"
  | "media"
  | "sources"
  | "status"
  | "scheduledFor"
  | "publishedAt"
  | "publishedUrl"
  | "generatedAt"
  | "generationVersion"
  | "evergreen"
>>;

export type UpdateGrowthContentItemInput = Partial<Pick<
  GrowthContentItem,
  | "planId"
  | "interventionId"
  | "goalIds"
  | "channel"
  | "format"
  | "pillar"
  | "angle"
  | "title"
  | "summary"
  | "body"
  | "threadPosts"
  | "media"
  | "sources"
  | "status"
  | "scheduledFor"
  | "publishedAt"
  | "publishedUrl"
  | "generatedAt"
  | "generationVersion"
  | "evergreen"
>>;

export interface GrowthContentItemFilters {
  repository?: string;
  status?: GrowthContentItemStatus;
  scheduledFrom?: string;
  scheduledTo?: string;
}

export const GROWTH_CARD_TEMPLATES = [
  "release",
  "milestone",
  "stats",
  "quote",
  "whats-new",
] as const;
export type GrowthCardTemplate = (typeof GROWTH_CARD_TEMPLATES)[number];

export interface GrowthReleaseCardData {
  version: string;
  highlights: string[];
}

export interface GrowthMilestoneCardData {
  value: number;
  label: string;
  detail: string;
}

export interface GrowthStatsCardData {
  stats: Array<{ label: string; value: number }>;
}

export interface GrowthQuoteCardData {
  quote: string;
  attribution: string;
}

export interface GrowthWhatsNewCardData {
  items: string[];
}

export interface GrowthCardDataByTemplate {
  release: GrowthReleaseCardData;
  milestone: GrowthMilestoneCardData;
  stats: GrowthStatsCardData;
  quote: GrowthQuoteCardData;
  "whats-new": GrowthWhatsNewCardData;
}

export type GrowthCardData = GrowthCardDataByTemplate[GrowthCardTemplate];
export type CreateGrowthCardInput = {
  [Template in GrowthCardTemplate]: {
    repository: string;
    template: Template;
    title: string;
    alt: string;
    data: GrowthCardDataByTemplate[Template];
  };
}[GrowthCardTemplate];

export type GrowthAssetKind = "image" | "video";
export type GrowthAssetOrigin = "upload" | "readme" | "website" | "generated";
export type GrowthAssetImportOrigin = Extract<GrowthAssetOrigin, "readme" | "website">;
export const MAX_GROWTH_ASSET_BYTES = 25 * 1024 * 1024;
export const GROWTH_ASSET_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/webm",
] as const;
export type GrowthAssetMimeType = (typeof GROWTH_ASSET_MIME_TYPES)[number];

export interface GrowthAsset {
  id: string;
  accountId: string;
  repository: string;
  kind: GrowthAssetKind;
  origin: GrowthAssetOrigin;
  path: string | null;
  url: string | null;
  title: string;
  alt: string;
  width: number | null;
  height: number | null;
  cardTemplate: string | null;
  cardData: Record<string, unknown> | null;
  createdAt: string;
}

export interface CreateGrowthAssetInput {
  accountId: string;
  repository: string;
  kind: GrowthAssetKind;
  origin: GrowthAssetOrigin;
  path?: string | null;
  url?: string | null;
  title: string;
  alt: string;
  width?: number | null;
  height?: number | null;
  cardTemplate?: string | null;
  cardData?: Record<string, unknown> | null;
}

/** Asset metadata safe to return to a browser. Stored filesystem paths are omitted. */
export type GrowthAssetMetadata = Omit<GrowthAsset, "path">;

export interface GrowthAssetsData {
  ok: true;
  assets: GrowthAssetMetadata[];
}

export interface GrowthAssetImportCandidate {
  origin: GrowthAssetImportOrigin;
  source: string;
  url: string;
  title: string;
  alt: string;
}

export interface GrowthAssetImportCandidatesData {
  ok: true;
  candidates: GrowthAssetImportCandidate[];
}

export interface ImportGrowthAssetInput {
  repository: string;
  origin: GrowthAssetImportOrigin;
  url: string;
  title: string;
  alt: string;
}

export interface GrowthAssetData {
  ok: true;
  asset: GrowthAssetMetadata;
}

export interface GrowthImportedAssetData extends GrowthAssetData {
  duplicate: boolean;
}

export interface UploadGrowthAssetInput {
  repository: string;
  file: Blob;
  filename: string;
  title: string;
  alt: string;
  width?: number;
  height?: number;
}

export type GrowthPerformanceWindow = "48h" | "7d";

export interface GrowthPerformanceMetrics {
  starsDelta?: number;
  forksDelta?: number;
  closedPrsDelta?: number;
  releaseDownloadsDelta?: number;
  [metric: string]: number | undefined;
}

export interface GrowthContentPerformance {
  accountId: string;
  contentId: string;
  window: GrowthPerformanceWindow;
  measuredAt: string;
  metrics: GrowthPerformanceMetrics;
}

export interface GrowthWorkspaceSummary {
  repository: string;
  interventionsByStatus: Record<GrowthInterventionStatus, number>;
  contentItemsByStatus: Record<GrowthContentItemStatus, number>;
  nextSevenDays: GrowthContentItem[];
}

export interface GrowthWorkspacesData {
  ok: true;
  workspaces: GrowthWorkspaceSummary[];
}

export interface GrowthWorkspaceData {
  ok: true;
  workspace: GrowthWorkspaceSummary;
}

export interface GrowthProfileData {
  ok: true;
  profile: GrowthProfile;
}

export interface GrowthInterventionsData {
  ok: true;
  interventions: GrowthIntervention[];
}

export interface GrowthInterventionData {
  ok: true;
  intervention: GrowthIntervention;
}

export interface GrowthGeneratedInterventionsData extends GrowthInterventionsData {
  aiEnabled: boolean;
}

export interface GrowthContentPlansData {
  ok: true;
  plans: GrowthContentPlan[];
}

export interface GrowthGeneratedContentPlanData {
  ok: true;
  plan: GrowthContentPlan;
  contentItems: GrowthContentItem[];
  aiEnabled: boolean;
  usedFallback: boolean;
}

export interface GrowthArchivedContentPlanData {
  ok: true;
  plan: GrowthContentPlan;
  contentItems: GrowthContentItem[];
}

export interface GrowthRegeneratedContentPlanData extends GrowthGeneratedContentPlanData {
  sourcePlan: GrowthContentPlan;
  affectedContentItems: GrowthContentItem[];
}

export interface GrowthContentItemsData {
  ok: true;
  contentItems: GrowthContentItem[];
}

export interface GrowthContentItemData {
  ok: true;
  contentItem: GrowthContentItem;
}

export interface GrowthDraftContentData extends GrowthContentItemsData {
  cached: boolean;
}

export interface GrowthDraftContentItemData extends GrowthContentItemData {
  aiEnabled: boolean;
  usedFallback: boolean;
  cached: boolean;
  mediaRequired: boolean;
}
