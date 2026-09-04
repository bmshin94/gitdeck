import type {
  CreateGrowthContentItemInput,
  CreateGrowthContentPlanInput,
  GenerateGrowthContentPlanInput,
  GrowthContentItem,
  GrowthContentPlan,
  GrowthPlanAssignment,
  GrowthPlanEvidence,
} from "../../types/growth";
import { normalizeGrowthPlanAssignments } from "../../utils/growth/planAssignments";
import { buildGrowthPlanSlots } from "../../utils/growth/planSlots";
import { AiNotConfiguredError, generateStructured } from "../ai/client";
import { isAiConfigured } from "../ai/settings";
import {
  createContentPlanWithItems,
  getContentPlan,
  getGrowthProfile,
  hasOverlappingActiveContentPlan,
  replaceContentPlanWithItems,
  ActivePlanOverlapError,
} from "./store";
import { collectRepositorySignals, type GrowthRepositorySignals } from "./signals";

export const GROWTH_PLANNER_GENERATION_VERSION = 1;

export interface GeneratedGrowthContentPlan {
  plan: GrowthContentPlan;
  contentItems: GrowthContentItem[];
  aiEnabled: boolean;
  usedFallback: boolean;
}

export interface RegeneratedGrowthContentPlan extends GeneratedGrowthContentPlan {
  sourcePlan: GrowthContentPlan;
  affectedContentItems: GrowthContentItem[];
}

interface PreparedGrowthContentPlan {
  planInput: CreateGrowthContentPlanInput;
  itemInputs: Array<Omit<CreateGrowthContentItemInput, "accountId" | "repository" | "planId">>;
  aiEnabled: boolean;
  usedFallback: boolean;
}

interface PlannerAnswer {
  assignments?: GrowthPlanAssignment[];
}

function additionalEvidence(sources: readonly unknown[]): GrowthPlanEvidence[] {
  return sources.flatMap((source) => {
    if (!source || typeof source !== "object" || Array.isArray(source)) return [];
    const record = source as Record<string, unknown>;
    const label = typeof record.title === "string"
      ? record.title
      : typeof record.repository === "string"
        ? record.repository
        : "Additional project source";
    const directUrl = typeof record.url === "string"
      ? record.url
      : typeof record.repository === "string"
        ? `https://github.com/${record.repository}`
        : null;
    const releases = Array.isArray(record.releases) ? record.releases : [];
    return [
      { label, url: directUrl },
      ...releases.flatMap((release) => {
        if (!release || typeof release !== "object" || Array.isArray(release)) return [];
        const item = release as Record<string, unknown>;
        return [{
          label: typeof item.name === "string" ? item.name : "Project release",
          url: typeof item.url === "string" ? item.url : null,
        }];
      }),
    ];
  });
}

function planEvidence(signals: GrowthRepositorySignals): GrowthPlanEvidence[] {
  return [
    {
      label: signals.repositoryMetadata?.description || signals.repository,
      url: signals.repositoryMetadata?.url ?? `https://github.com/${signals.repository}`,
    },
    ...signals.releases.map((release) => ({
      label: release.name || release.tag_name || "Repository release",
      url: release.html_url ?? null,
    })),
    ...signals.recentCommits.slice(0, 10).map((commit) => ({
      label: commit.commit.message.split("\n")[0] || "Repository update",
      url: commit.html_url,
    })),
    ...signals.openIssues.slice(0, 10).map((issue) => ({ label: issue.title, url: issue.url })),
    ...signals.openPullRequests.slice(0, 6).map((pullRequest) => ({
      label: pullRequest.title,
      url: pullRequest.url,
    })),
    ...additionalEvidence(signals.additionalSources),
  ];
}

function plannerContext(signals: GrowthRepositorySignals, evidence: GrowthPlanEvidence[]): Record<string, unknown> {
  return {
    generatedOn: signals.generatedOn,
    repository: signals.repository,
    repositoryMetadata: signals.repositoryMetadata ? {
      description: signals.repositoryMetadata.description,
      primaryLanguage: signals.repositoryMetadata.primaryLanguage?.name ?? null,
      stars: signals.repositoryMetadata.stargazerCount,
      forks: signals.repositoryMetadata.forkCount,
      url: signals.repositoryMetadata.url,
    } : null,
    releases: signals.releases.map((release) => ({
      name: release.name || release.tag_name || null,
      url: release.html_url ?? null,
      publishedAt: release.published_at ?? null,
      notesExcerpt: release.body?.replace(/\s+/g, " ").trim().slice(0, 500) || null,
    })),
    recentCommits: signals.recentCommits.slice(0, 10).map((commit) => ({
      message: commit.commit.message.split("\n")[0],
      url: commit.html_url,
      authoredAt: commit.commit.author?.date ?? null,
    })),
    openIssues: signals.openIssues.slice(0, 10).map((issue) => ({
      title: issue.title,
      url: issue.url,
      updatedAt: issue.updatedAt,
    })),
    openPullRequests: signals.openPullRequests.slice(0, 6).map((pullRequest) => ({
      title: pullRequest.title,
      url: pullRequest.url,
      updatedAt: pullRequest.updatedAt,
      isDraft: pullRequest.isDraft,
    })),
    readmeExcerpt: signals.readme?.excerpt ?? null,
    starHistory: signals.starHistory,
    goals: signals.goals,
    additionalSources: signals.additionalSources,
    allowedEvidence: evidence,
  };
}

async function requestAssignments(
  input: GenerateGrowthContentPlanInput,
  slots: ReturnType<typeof buildGrowthPlanSlots>,
  profile: ReturnType<typeof getGrowthProfile>,
  signals: GrowthRepositorySignals,
  evidence: GrowthPlanEvidence[],
): Promise<unknown> {
  const result = await generateStructured<PlannerAnswer>({
    instructions: [
      "Act as an ethical open-source editorial planner.",
      "Return one assignment for every supplied slot, keyed by its exact slotKey.",
      "Confirm a positive-weight pillar from the supplied profile, write a concise one-line evidence-led angle and CTA, and cite only HTTP or HTTPS URLs present in allowedEvidence.",
      "Use only supplied facts, do not imply unfinished work has shipped, and do not draft the final post.",
      "Return JSON only.",
    ].join(" "),
    input: JSON.stringify({
      repository: input.repository,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      profile: {
        language: profile.language,
        voice: profile.voice,
        audience: profile.audience,
        pillars: profile.pillars,
        hashtags: profile.hashtags,
        avoid: profile.avoid,
      },
      slots,
      evidence: plannerContext(signals, evidence),
    }),
    schemaName: "growth_editorial_plan",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        assignments: {
          type: "array",
          minItems: 0,
          maxItems: slots.length,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              slotKey: { type: "string" },
              pillarId: { type: "string" },
              angle: { type: "string" },
              sources: { type: "array", items: { type: "string", format: "uri" } },
              cta: { type: "string" },
            },
            required: ["slotKey", "pillarId", "angle", "sources", "cta"],
          },
        },
      },
      required: ["assignments"],
    },
    maxOutputTokens: Math.min(16_000, Math.max(1_200, slots.length * 140)),
  });
  return result.data.assignments;
}

async function prepareGrowthContentPlan(
  accountId: string,
  input: GenerateGrowthContentPlanInput,
  excludePlanId?: string,
): Promise<PreparedGrowthContentPlan> {
  const profile = getGrowthProfile(accountId, input.repository);
  const slots = buildGrowthPlanSlots({
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    channels: profile.channels,
    cadence: profile.cadence,
    pillars: profile.pillars,
    postingWindows: profile.postingWindows,
    timezone: profile.timezone,
  });
  if (hasOverlappingActiveContentPlan(
    accountId,
    input.repository,
    input.periodStart,
    input.periodEnd,
    excludePlanId,
  )) {
    throw new ActivePlanOverlapError();
  }

  const signals = await collectRepositorySignals(accountId, input.repository);
  const evidence = planEvidence(signals);
  const aiEnabled = isAiConfigured();
  let candidates: unknown = [];
  if (aiEnabled && slots.length > 0) {
    try {
      candidates = await requestAssignments(input, slots, profile, signals, evidence);
    } catch (error) {
      if (!(error instanceof AiNotConfiguredError)) throw error;
    }
  }
  const normalized = normalizeGrowthPlanAssignments(
    input.repository,
    slots,
    profile.pillars,
    evidence,
    candidates,
  );
  const generatedAt = new Date().toISOString();
  return {
    planInput: {
      accountId,
      repository: input.repository,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      cadence: profile.cadence,
      pillars: profile.pillars,
      status: "active",
      generatedAt,
    },
    itemInputs: slots.map((slot, index) => {
      const assignment = normalized.assignments[index];
      return {
        channel: slot.channel,
        format: slot.format,
        goalIds: [],
        pillar: assignment.pillarId,
        angle: assignment.angle,
        title: "",
        summary: assignment.cta,
        body: "",
        threadPosts: [],
        media: [],
        sources: assignment.sources,
        status: "idea" as const,
        scheduledFor: slot.scheduledFor,
        generatedAt,
        generationVersion: GROWTH_PLANNER_GENERATION_VERSION,
        evergreen: 0 as const,
      };
    }),
    aiEnabled,
    usedFallback: !aiEnabled || normalized.usedFallback,
  };
}

/** Builds, enriches, and atomically persists one repository editorial plan. */
export async function generateGrowthContentPlan(
  accountId: string,
  input: GenerateGrowthContentPlanInput,
): Promise<GeneratedGrowthContentPlan> {
  const prepared = await prepareGrowthContentPlan(accountId, input);
  const created = createContentPlanWithItems(prepared.planInput, prepared.itemInputs);
  return {
    ...created,
    aiEnabled: prepared.aiEnabled,
    usedFallback: prepared.usedFallback,
  };
}

/** Builds a replacement before atomically archiving and superseding the source plan. */
export async function regenerateGrowthContentPlan(
  accountId: string,
  sourcePlanId: string,
): Promise<RegeneratedGrowthContentPlan | null> {
  const source = getContentPlan(accountId, sourcePlanId);
  if (!source) return null;
  const prepared = await prepareGrowthContentPlan(accountId, {
    repository: source.repository,
    periodStart: source.periodStart,
    periodEnd: source.periodEnd,
  }, source.id);
  const replaced = replaceContentPlanWithItems(
    accountId,
    source.id,
    prepared.planInput,
    prepared.itemInputs,
  );
  return replaced ? {
    ...replaced,
    aiEnabled: prepared.aiEnabled,
    usedFallback: prepared.usedFallback,
  } : null;
}
