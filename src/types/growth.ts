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

export type GrowthAssetKind = "image" | "video";
export type GrowthAssetOrigin = "upload" | "readme" | "website" | "generated";

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
