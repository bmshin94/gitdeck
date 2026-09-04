import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { rm } from "node:fs/promises";

const state = vi.hoisted(() => {
  const { tmpdir } = require("node:os") as typeof import("node:os");
  const { resolve } = require("node:path") as typeof import("node:path");
  return {
    tmpDir: resolve(tmpdir(), `gitdeck-growth-planner-${process.pid}-${Date.now()}`),
    aiConfigured: true,
    generateStructured: vi.fn(),
    collectSignals: vi.fn(),
  };
});

vi.mock("../../src/server/config", () => ({ DATA_DIR: state.tmpDir }));
vi.mock("../../src/server/ai/settings", () => ({
  isAiConfigured: vi.fn(() => state.aiConfigured),
}));
vi.mock("../../src/server/ai/client", async (importActual) => ({
  ...await importActual<typeof import("../../src/server/ai/client")>(),
  generateStructured: state.generateStructured,
}));
vi.mock("../../src/server/growth/signals", () => ({
  collectRepositorySignals: state.collectSignals,
}));

const {
  GROWTH_PLANNER_GENERATION_VERSION,
  generateGrowthContentPlan,
} = await import("../../src/server/growth/planner");
const store = await import("../../src/server/growth/store");
const { AiRequestError } = await import("../../src/server/ai/client");
const { closeDatabase, getDatabase } = await import("../../src/server/sqlite");

function profileInput() {
  return {
    language: "en",
    voice: "Direct",
    audience: "Maintainers",
    channels: { x: true, linkedin: false, mastodon: false, bluesky: false, discussion: false, blog: false },
    cadence: { x: 2, linkedin: 0, mastodon: 0, bluesky: 0, discussion: 0, blog: 0 },
    pillars: [
      { id: "product", label: "Product", weight: 70, description: "Outcomes" },
      { id: "community", label: "Community", weight: 30, description: "Contributors" },
    ],
    hashtags: ["#opensource"],
    avoid: "Hype",
    timezone: "UTC",
    postingWindows: [{ weekday: 1, hour: 10 }, { weekday: 5, hour: 14 }],
    color: "#2563EB",
  };
}

function signals(repository = "acme/rocket") {
  return {
    generatedOn: "2026-09-04",
    repository,
    repositoryMetadata: {
      nameWithOwner: repository,
      name: "rocket",
      owner: { login: "acme" },
      description: "A verified repository description",
      stargazerCount: 42,
      forkCount: 7,
      primaryLanguage: { name: "TypeScript" },
      updatedAt: "2026-09-04T00:00:00Z",
      pushedAt: "2026-09-04T00:00:00Z",
      visibility: "PUBLIC",
      isPrivate: false,
      isArchived: false,
      isFork: false,
      url: `https://github.com/${repository}`,
    },
    openIssues: [],
    openPullRequests: [],
    releases: [{ name: "Release v2", html_url: `https://github.com/${repository}/releases/v2` }],
    readme: { excerpt: "Verified README", mediaUrls: [] },
    additionalSources: [],
    recentCommits: [],
    starHistory: [],
    goals: [],
  };
}

function saveProfile(accountId = "account-a", repository = "acme/rocket") {
  return store.upsertGrowthProfile(accountId, repository, profileInput());
}

beforeEach(async () => {
  closeDatabase();
  await rm(state.tmpDir, { recursive: true, force: true });
  state.aiConfigured = true;
  state.collectSignals.mockReset();
  state.collectSignals.mockResolvedValue(signals());
  state.generateStructured.mockReset();
  state.generateStructured.mockImplementation(async (request: { input: string }) => {
    const input = JSON.parse(request.input) as { slots: Array<{ key: string; pillarId: string }> };
    return {
      provider: "test",
      model: "test",
      data: {
        assignments: input.slots.map((slot, index) => ({
          slotKey: slot.key,
          pillarId: index === 0 ? "community" : slot.pillarId,
          angle: `Verified angle ${index + 1}`,
          sources: [`https://github.com/acme/rocket/releases/v2`],
          cta: `Try action ${index + 1}`,
        })),
      },
    };
  });
});

afterAll(async () => {
  closeDatabase();
  await rm(state.tmpDir, { recursive: true, force: true });
});

describe("Growth editorial planner", () => {
  it("collects evidence once, makes one structured call, normalizes, and persists every slot", async () => {
    saveProfile();

    const result = await generateGrowthContentPlan("account-a", {
      repository: "acme/rocket",
      periodStart: "2026-09-07",
      periodEnd: "2026-09-13",
    });

    expect(state.collectSignals).toHaveBeenCalledTimes(1);
    expect(state.collectSignals).toHaveBeenCalledWith("account-a", "acme/rocket");
    expect(state.generateStructured).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ aiEnabled: true, usedFallback: false, plan: { status: "active" } });
    expect(result.contentItems).toHaveLength(2);
    expect(result.contentItems[0]).toMatchObject({
      planId: result.plan.id,
      accountId: "account-a",
      repository: "acme/rocket",
      channel: "x",
      format: "x-thread",
      pillar: "community",
      angle: "Verified angle 1",
      title: "",
      summary: "Try action 1",
      body: "",
      threadPosts: [],
      media: [],
      status: "idea",
      generationVersion: GROWTH_PLANNER_GENERATION_VERSION,
    });
    expect(result.contentItems[0].scheduledFor).toBe("2026-09-07T10:00:00.000Z");
    expect(store.getContentPlan("account-a", result.plan.id)).toEqual(result.plan);
  });

  it("uses deterministic evidence-grounded assignments when AI is unavailable or unusable", async () => {
    saveProfile();
    state.aiConfigured = false;
    const first = await generateGrowthContentPlan("account-a", {
      repository: "acme/rocket",
      periodStart: "2026-09-07",
      periodEnd: "2026-09-13",
    });
    store.archiveContentPlan("account-a", first.plan.id);
    const second = await generateGrowthContentPlan("account-a", {
      repository: "acme/rocket",
      periodStart: "2026-09-07",
      periodEnd: "2026-09-13",
    });

    expect(first.usedFallback).toBe(true);
    expect(second.usedFallback).toBe(true);
    expect(state.generateStructured).not.toHaveBeenCalled();
    expect(first.contentItems.map(({ pillar, angle, summary, sources, scheduledFor }) => ({
      pillar, angle, summary, sources, scheduledFor,
    }))).toEqual(second.contentItems.map(({ pillar, angle, summary, sources, scheduledFor }) => ({
      pillar, angle, summary, sources, scheduledFor,
    })));
    expect(first.contentItems[0].angle).toContain("verified repository description");

    store.archiveContentPlan("account-a", second.plan.id);
    state.aiConfigured = true;
    state.generateStructured.mockResolvedValueOnce({ provider: "test", model: "test", data: { assignments: [{ slotKey: "unknown" }] } });
    const malformed = await generateGrowthContentPlan("account-a", {
      repository: "acme/rocket",
      periodStart: "2026-09-07",
      periodEnd: "2026-09-13",
    });
    expect(malformed.usedFallback).toBe(true);
    expect(malformed.contentItems).toHaveLength(2);
  });

  it("does not persist configured-provider failures or partial database writes", async () => {
    saveProfile();
    state.generateStructured.mockRejectedValueOnce(new AiRequestError("provider failed"));
    await expect(generateGrowthContentPlan("account-a", {
      repository: "acme/rocket",
      periodStart: "2026-09-07",
      periodEnd: "2026-09-13",
    })).rejects.toThrow("provider failed");
    expect(store.listContentPlans("account-a", "acme/rocket")).toEqual([]);
    expect(store.listContentItems("account-a", { repository: "acme/rocket" })).toEqual([]);

    state.aiConfigured = false;
    store.ensureGrowthSchema();
    getDatabase().exec(`
      CREATE TRIGGER fail_planner_items BEFORE INSERT ON content_items
      BEGIN SELECT RAISE(ABORT, 'forced content failure'); END;
    `);
    await expect(generateGrowthContentPlan("account-a", {
      repository: "acme/rocket",
      periodStart: "2026-09-07",
      periodEnd: "2026-09-13",
    })).rejects.toThrow("forced content failure");
    expect(store.listContentPlans("account-a", "acme/rocket")).toEqual([]);
    expect(store.listContentItems("account-a", { repository: "acme/rocket" })).toEqual([]);
  });

  it("rejects overlapping active plans per account and lists plans in descending period order", async () => {
    saveProfile();
    state.aiConfigured = false;
    const early = await generateGrowthContentPlan("account-a", {
      repository: "acme/rocket",
      periodStart: "2026-09-07",
      periodEnd: "2026-09-13",
    });
    await expect(generateGrowthContentPlan("account-a", {
      repository: "acme/rocket",
      periodStart: "2026-09-07",
      periodEnd: "2026-09-20",
    })).rejects.toBeInstanceOf(store.ActivePlanOverlapError);

    const late = await generateGrowthContentPlan("account-a", {
      repository: "acme/rocket",
      periodStart: "2026-09-21",
      periodEnd: "2026-09-27",
    });
    expect(store.listContentPlans("account-a", "acme/rocket").map(({ id }) => id))
      .toEqual([late.plan.id, early.plan.id]);
    expect(store.listContentPlans("account-b", "acme/rocket")).toEqual([]);

    saveProfile("account-b");
    await expect(generateGrowthContentPlan("account-b", {
      repository: "acme/rocket",
      periodStart: "2026-09-07",
      periodEnd: "2026-09-13",
    })).resolves.toMatchObject({ plan: { accountId: "account-b" } });
  });
});
